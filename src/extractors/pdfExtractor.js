const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

// Otimização de memória: desabilitar cache e limitar threads do sharp
sharp.cache(false);
sharp.concurrency(1);

// Importação dinâmica do pdfjs-dist para compatibilidade com ESM
let pdfjsLib = null;

async function getPdfjs() {
    if (!pdfjsLib) {
        pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsLib;
}

/**
 * Extrator de conteúdo de PDFs
 * Extrai texto e imagens de documentos PDF
 */
class PDFExtractor {
    
    /**
     * Extrai todo o conteúdo do PDF (texto e imagens)
     * @param {string} filePath - Caminho do arquivo PDF
     * @returns {Object} - Objeto com texto, imagens e metadados
     */
    async extractAll(filePath, options = {}) {
        const pdfBuffer = fs.readFileSync(filePath);
        const { maxWidth = 800, pages: pageFilter = null } = options;
        
        // Extrair SEQUENCIALMENTE para economizar memória (não usar Promise.all)
        const textData = await this.extractTextFromBuffer(pdfBuffer);
        const images = await this.extractImagesFromBuffer(pdfBuffer, { maxWidth, pages: pageFilter });
        const metadata = await this.extractMetadata(pdfBuffer);
        
        // Agrupar imagens por página junto com o texto
        const pages = textData.pages.map(page => {
            const pageImages = images.filter(img => img.page === page.pageNumber);
            return {
                pageNumber: page.pageNumber,
                text: page.text,
                characterCount: page.characterCount,
                images: pageImages,
                imageCount: pageImages.length
            };
        });
        
        return {
            metadata,
            pages,
            fullText: textData.fullText,
            allImages: images,
            summary: {
                totalPages: pages.length,
                totalImages: images.length,
                totalCharacters: textData.fullText.length,
                pagesWithImages: pages.filter(p => p.imageCount > 0).length
            }
        };
    }
    
    /**
     * Extrai conteúdo do PDF otimizado para provas de concurso
     * Pula página 1 (capa/instruções), redimensiona imagens
     * @param {string} filePath - Caminho do arquivo PDF
     * @param {Object} options - {skipFirstPage: true, maxImageWidth: 800}
     * @returns {Object} - {pages: [{pageNumber, text, images}], totalPages}
     */
    async extractForExam(filePath, options = {}) {
        const { skipFirstPage = true, maxImageWidth = 800 } = options;
        const pdfBuffer = fs.readFileSync(filePath);
        const startPage = skipFirstPage ? 2 : 1;
        
        // Extrair SEQUENCIALMENTE para economizar memória
        const textData = await this.extractTextFromBuffer(pdfBuffer);
        const images = await this.extractImagesFromBuffer(pdfBuffer, { maxWidth: maxImageWidth, startPage });
        
        // Agrupar por página (já filtrado por startPage nas imagens)
        const pages = textData.pages
            .filter(p => p.pageNumber >= startPage)
            .map(page => {
                const pageImages = images.filter(img => img.page === page.pageNumber);
                return {
                    pageNumber: page.pageNumber,
                    text: page.text,
                    images: pageImages,
                    questionRanges: page.questionRanges || []
                };
            });
        
        return { pages, totalPages: textData.totalPages };
    }
    
    /**
     * Extrai apenas as imagens do PDF
     * @param {string} filePath - Caminho do arquivo PDF
     * @returns {Array} - Array de imagens em base64
     */
    async extractImages(filePath) {
        const pdfBuffer = fs.readFileSync(filePath);
        return await this.extractImagesFromBuffer(pdfBuffer);
    }
    
    /**
     * Extrai apenas o texto do PDF
     * @param {string} filePath - Caminho do arquivo PDF
     * @returns {Object} - Objeto com texto por página e texto completo
     */
    async extractText(filePath) {
        const pdfBuffer = fs.readFileSync(filePath);
        return await this.extractTextFromBuffer(pdfBuffer);
    }
    
    /**
     * Extrai texto do buffer do PDF
     * @param {Buffer} pdfBuffer - Buffer do PDF
     * @returns {Object} - Texto extraído
     */
    async extractTextFromBuffer(pdfBuffer) {
        const pdfjs = await getPdfjs();
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(pdfBuffer),
            useSystemFonts: true
        });
        
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;
        const pages = [];
        let fullText = '';
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // Extrair texto + detectar ranges Y de cada questão
            let pageText = '';
            let lastY = null;
            const questionRanges = []; // { numero, yMin, yMax, textItems: [] }
            let currentQuestion = null;
            
            for (const item of textContent.items) {
                if (item.str) {
                    const itemY = item.transform[5]; // Posição Y do baseline do texto
                    
                    // Detectar quebras de linha
                    if (lastY !== null && Math.abs(lastY - itemY) > 5) {
                        pageText += '\n';
                    }
                    pageText += item.str;
                    lastY = itemY;
                    
                    // Detectar início de nova questão
                    const qMatch = item.str.match(/Quest[ãa]o\s+(\d{1,3})/i);
                    if (qMatch) {
                        const num = parseInt(qMatch[1]);
                        if (num > 0 && num <= 200) {
                            // Fechar questão anterior
                            if (currentQuestion && currentQuestion.textItems.length > 0) {
                                currentQuestion.yMin = Math.min(...currentQuestion.textItems);
                                currentQuestion.yMax = Math.max(...currentQuestion.textItems);
                                delete currentQuestion.textItems;
                            }
                            // Iniciar nova questão
                            currentQuestion = { numero: num, textItems: [itemY] };
                            questionRanges.push(currentQuestion);
                        }
                    } else if (currentQuestion) {
                        // Adicionar Y à questão atual
                        currentQuestion.textItems.push(itemY);
                    }
                }
            }
            
            // Fechar última questão
            if (currentQuestion && currentQuestion.textItems.length > 0) {
                currentQuestion.yMin = Math.min(...currentQuestion.textItems);
                currentQuestion.yMax = Math.max(...currentQuestion.textItems);
                delete currentQuestion.textItems;
            }
            
            // DEBUG - log página 8
            if (pageNum === 8 && questionRanges.length > 0) {
                console.log(`DEBUG pág ${pageNum}: ${questionRanges.length} questionRanges detectados:`, 
                    questionRanges.map(q => `Q${q.numero} [${q.yMin?.toFixed(1) || 'null'}-${q.yMax?.toFixed(1) || 'null'}]`).join(', '));
            }
            
            pages.push({
                pageNumber: pageNum,
                text: pageText.trim(),
                characterCount: pageText.trim().length,
                questionRanges // [{ numero, yMin, yMax }]
            });
            
            fullText += pageText + '\n\n';
        }
        
        await pdfDoc.destroy();
        
        return {
            pages,
            fullText: fullText.trim(),
            totalPages: numPages
        };
    }
    
    /**
     * Extrai imagens embutidas do PDF
     * @param {Buffer} pdfBuffer - Buffer do PDF
     * @param {Object} options - {maxWidth: null, startPage: 1}
     * @returns {Array} - Array de objetos com imagens em base64
     */
    async extractImagesFromBuffer(pdfBuffer, options = {}) {
        const { maxWidth = 800, startPage = 1, pages = null } = options;
        const images = [];
        const MAX_IMAGES = 300; // Limite de segurança (150 era pouco para ENEM 64 pgs)
        
        try {
            const pdfjs = await getPdfjs();
            const loadingTask = pdfjs.getDocument({
                data: new Uint8Array(pdfBuffer),
                useSystemFonts: true
            });
            
            const pdfDoc = await loadingTask.promise;
            const numPages = pdfDoc.numPages;
            let abortedByMemory = false;
            
            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                // Pular páginas antes de startPage
                if (pageNum < startPage) continue;
                // Filtrar por lista de páginas específicas (economia de memória)
                if (pages && !pages.includes(pageNum)) continue;
                // Limite de imagens
                if (images.length >= MAX_IMAGES) {
                    console.log(`⚠️ Limite de ${MAX_IMAGES} imagens atingido, parando extração`);
                    break;
                }
                // Verificar pressão de memória (abortar se > 400MB RSS)
                const memCheck = process.memoryUsage();
                if (memCheck.rss > 400 * 1024 * 1024) {
                    console.log(`⚠️ Memória alta: RSS=${(memCheck.rss/1024/1024).toFixed(0)}MB - parando extração de imagens na pág ${pageNum}`);
                    abortedByMemory = true;
                    break;
                }
                
                const page = await pdfDoc.getPage(pageNum);
                const operatorList = await page.getOperatorList();
                
                // Buscar imagens nas operações
                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    
                    // OPS.paintImageXObject = 85, OPS.paintInlineImageXObject = 86
                    if (fn === 85 || fn === 86) {
                        try {
                            const imgName = operatorList.argsArray[i][0];
                            
                            // Extrair posição Y procurando transform antes da imagem
                            // OPS.transform = 12
                            let imgYPos = null;
                            for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
                                if (operatorList.fnArray[j] === 12) {
                                    const transformArgs = operatorList.argsArray[j];
                                    // Matrix: [a, b, c, d, e, f] onde f = translateY
                                    if (Array.isArray(transformArgs) && transformArgs.length >= 6) {
                                        imgYPos = transformArgs[5];
                                        break;
                                    } else if (Array.isArray(transformArgs) && transformArgs[0] && transformArgs[0].length >= 6) {
                                        imgYPos = transformArgs[0][5];
                                        break;
                                    }
                                }
                            }
                            
                            // Tentar obter a imagem
                            const imgData = await this.extractImageFromPage(page, imgName, pageNum, images.length + 1, maxWidth);
                            if (imgData) {
                                imgData.yPos = imgYPos;
                                
                                // DEBUG - log imagem página 8
                                if (pageNum === 8) {
                                    console.log(`DEBUG pág ${pageNum}: Imagem ${imgData.id} extraída com yPos=${imgYPos?.toFixed(1) || 'null'}`);
                                }
                                
                                images.push(imgData);
                            }
                        } catch (imgError) {
                            console.log(`Aviso: Não foi possível extrair imagem na página ${pageNum}:`, imgError.message);
                        }
                    }
                }
                
                // CRUCIAL: liberar recursos da página para não acumular memória
                page.cleanup();
            }
            
            await pdfDoc.destroy();
            
            if (abortedByMemory) {
                console.log(`⚠️ Extração parcial: ${images.length} imagens (limitada por memória)`);
            }
            
        } catch (error) {
            console.error('Erro ao extrair imagens com pdfjs:', error.message);
            
            // Fallback: tentar extrair com pdf-lib
            try {
                const fallbackImages = await this.extractImagesWithPdfLib(pdfBuffer, { maxWidth, startPage });
                images.push(...fallbackImages);
            } catch (fallbackError) {
                console.error('Erro no fallback com pdf-lib:', fallbackError.message);
            }
        }
        
        return images;
    }
    
    /**
     * Extrai uma imagem específica de uma página
     * @param {number} maxWidth - Largura máxima para redimensionamento (null = sem resize)
     */
    async extractImageFromPage(page, imgName, pageNum, imgIndex, maxWidth = 800) {
        try {
            const objs = page.objs;
            
            // Esperar o objeto da imagem estar disponível
            let imgObj = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout ao carregar imagem'));
                }, 5000);
                
                objs.get(imgName, (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
            });
            
            if (!imgObj || !imgObj.data) {
                return null;
            }
            
            const { width, height, kind } = imgObj;
            let rawData = imgObj.data;
            imgObj = null; // Liberar referência ao objeto original
            
            if (!width || !height || !rawData) {
                return null;
            }
            
            // Pular imagens muito pequenas (decorativas, ícones)
            if (width < 50 || height < 50) {
                rawData = null;
                return null;
            }
            
            // Converter dados da imagem para PNG usando sharp
            let channels = 4; // RGBA por padrão
            let inputOptions = { raw: { width, height, channels } };
            
            // Ajustar baseado no tipo de imagem
            if (kind === 1) { // Grayscale
                channels = 1;
                inputOptions = { raw: { width, height, channels: 1 } };
            } else if (kind === 2) { // RGB
                channels = 3;
                inputOptions = { raw: { width, height, channels: 3 } };
            } else if (kind === 3) { // RGBA
                channels = 4;
                inputOptions = { raw: { width, height, channels: 4 } };
            }
            
            // Criar buffer com o tamanho correto
            const expectedSize = width * height * channels;
            
            if (rawData.length !== expectedSize) {
                // Tentar ajustar o número de canais
                if (rawData.length === width * height * 3) {
                    channels = 3;
                    inputOptions = { raw: { width, height, channels: 3 } };
                } else if (rawData.length === width * height * 4) {
                    channels = 4;
                    inputOptions = { raw: { width, height, channels: 4 } };
                } else if (rawData.length === width * height) {
                    channels = 1;
                    inputOptions = { raw: { width, height, channels: 1 } };
                } else {
                    console.log(`Tamanho de dados inesperado: ${rawData.length}, esperado: ${expectedSize}`);
                    rawData = null;
                    return null;
                }
            }
            
            // Converter para JPEG Q80 (5-10x menor que PNG, economia enorme de memória)
            // Usar Buffer.from com shared ArrayBuffer quando possível
            const inputBuffer = Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength);
            rawData = null; // Liberar referência ao raw data
            
            let pipeline = sharp(inputBuffer, inputOptions);
            
            // Sempre aplicar maxWidth (default 800px) para controlar tamanho
            if (maxWidth && width > maxWidth) {
                pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
            }
            
            const { data: outputBuffer, info } = await pipeline
                .jpeg({ quality: 75 })
                .toBuffer({ resolveWithObject: true });
            
            const base64 = outputBuffer.toString('base64');
            
            return {
                id: `img_${pageNum}_${imgIndex}`,
                page: pageNum,
                width: info.width,
                height: info.height,
                format: 'jpeg',
                mimeType: 'image/jpeg',
                dataUrl: `data:image/jpeg;base64,${base64}`,
                sizeBytes: outputBuffer.length
            };
            
        } catch (error) {
            console.log(`Erro ao processar imagem: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Fallback: Extrai imagens usando pdf-lib
     */
    async extractImagesWithPdfLib(pdfBuffer, options = {}) {
        const { maxWidth = null, startPage = 1 } = options;
        const images = [];
        
        try {
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const pages = pdfDoc.getPages();
            
            let imageIndex = 0;
            
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
                // Pular páginas antes de startPage
                if (pageIndex + 1 < startPage) continue;
                const page = pages[pageIndex];
                const resources = page.node.get(page.node.context.obj('Resources'));
                
                if (!resources) continue;
                
                const xObject = resources.get(page.node.context.obj('XObject'));
                if (!xObject) continue;
                
                const keys = xObject.keys();
                
                for (const key of keys) {
                    try {
                        const obj = xObject.get(key);
                        if (!obj) continue;
                        
                        const subtype = obj.get(obj.context.obj('Subtype'));
                        if (subtype && subtype.toString() === '/Image') {
                            imageIndex++;
                            
                            // Tentar extrair dados da imagem
                            const width = obj.get(obj.context.obj('Width'))?.toString();
                            const height = obj.get(obj.context.obj('Height'))?.toString();
                            
                            // Obter stream de dados
                            const stream = obj.getContents();
                            if (stream) {
                                const base64 = Buffer.from(stream).toString('base64');
                                
                                // Detectar o tipo de imagem baseado nos bytes iniciais
                                let mimeType = 'image/png';
                                let format = 'png';
                                
                                if (stream[0] === 0xFF && stream[1] === 0xD8) {
                                    mimeType = 'image/jpeg';
                                    format = 'jpeg';
                                } else if (stream[0] === 0x89 && stream[1] === 0x50) {
                                    mimeType = 'image/png';
                                    format = 'png';
                                }
                                
                                images.push({
                                    id: `img_pdflib_${pageIndex + 1}_${imageIndex}`,
                                    page: pageIndex + 1,
                                    width: parseInt(width) || null,
                                    height: parseInt(height) || null,
                                    format,
                                    mimeType,
                                    base64,
                                    dataUrl: `data:${mimeType};base64,${base64}`,
                                    sizeBytes: stream.length
                                });
                            }
                        }
                    } catch (objError) {
                        // Ignorar erros em objetos individuais
                    }
                }
            }
        } catch (error) {
            console.error('Erro no fallback pdf-lib:', error.message);
        }
        
        return images;
    }
    
    /**
     * Converte cada página do PDF em uma imagem
     * @param {string} filePath - Caminho do arquivo PDF
     * @param {Object} options - Opções de conversão (dpi, format)
     * @returns {Array} - Array de imagens das páginas em base64
     */
    async convertPagesToImages(filePath, options = {}) {
        const { dpi = 150, format = 'png' } = options;
        const scale = dpi / 72; // 72 DPI é o padrão do PDF
        
        const pdfBuffer = fs.readFileSync(filePath);
        const pdfjs = await getPdfjs();
        const loadingTask = pdfjs.getDocument({
            data: new Uint8Array(pdfBuffer),
            useSystemFonts: true
        });
        
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages;
        const pages = [];
        
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            
            // Criar canvas com node-canvas ou similar
            // Como não temos canvas nativo no Node, vamos usar uma abordagem diferente
            const { width, height } = viewport;
            
            // Renderizar usando operações do pdfjs
            const operatorList = await page.getOperatorList();
            
            // Para renderização completa, seria necessário usar canvas
            // Aqui retornamos informações da página
            pages.push({
                pageNumber: pageNum,
                width: Math.round(width),
                height: Math.round(height),
                dpi,
                message: 'Para renderização completa de páginas, instale o pacote canvas: npm install canvas'
            });
        }
        
        await pdfDoc.destroy();
        
        return pages;
    }
    
    /**
     * Extrai metadados do PDF
     * @param {Buffer} pdfBuffer - Buffer do PDF
     * @returns {Object} - Metadados do documento
     */
    async extractMetadata(pdfBuffer) {
        try {
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            
            return {
                title: pdfDoc.getTitle() || null,
                author: pdfDoc.getAuthor() || null,
                subject: pdfDoc.getSubject() || null,
                creator: pdfDoc.getCreator() || null,
                producer: pdfDoc.getProducer() || null,
                creationDate: pdfDoc.getCreationDate()?.toISOString() || null,
                modificationDate: pdfDoc.getModificationDate()?.toISOString() || null,
                pageCount: pdfDoc.getPageCount(),
                keywords: pdfDoc.getKeywords() || null
            };
        } catch (error) {
            console.error('Erro ao extrair metadados:', error.message);
            return {
                error: 'Não foi possível extrair metadados',
                pageCount: null
            };
        }
    }
}

module.exports = new PDFExtractor();
