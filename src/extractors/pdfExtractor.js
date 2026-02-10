const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

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
    async extractAll(filePath) {
        const pdfBuffer = fs.readFileSync(filePath);
        
        // Extrair texto e imagens em paralelo
        const [textData, images, metadata] = await Promise.all([
            this.extractTextFromBuffer(pdfBuffer),
            this.extractImagesFromBuffer(pdfBuffer),
            this.extractMetadata(pdfBuffer)
        ]);
        
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
            
            // Extrair texto mantendo a estrutura
            let pageText = '';
            let lastY = null;
            
            for (const item of textContent.items) {
                if (item.str) {
                    // Detectar quebras de linha baseado na posição Y
                    if (lastY !== null && Math.abs(lastY - item.transform[5]) > 5) {
                        pageText += '\n';
                    }
                    pageText += item.str;
                    lastY = item.transform[5];
                }
            }
            
            pages.push({
                pageNumber: pageNum,
                text: pageText.trim(),
                characterCount: pageText.trim().length
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
     * @returns {Array} - Array de objetos com imagens em base64
     */
    async extractImagesFromBuffer(pdfBuffer) {
        const images = [];
        
        try {
            const pdfjs = await getPdfjs();
            const loadingTask = pdfjs.getDocument({
                data: new Uint8Array(pdfBuffer),
                useSystemFonts: true
            });
            
            const pdfDoc = await loadingTask.promise;
            const numPages = pdfDoc.numPages;
            
            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const operatorList = await page.getOperatorList();
                
                // Buscar imagens nas operações
                for (let i = 0; i < operatorList.fnArray.length; i++) {
                    const fn = operatorList.fnArray[i];
                    
                    // OPS.paintImageXObject = 85, OPS.paintInlineImageXObject = 86
                    if (fn === 85 || fn === 86) {
                        try {
                            const imgName = operatorList.argsArray[i][0];
                            
                            // Tentar obter a imagem
                            const imgData = await this.extractImageFromPage(page, imgName, pageNum, images.length + 1);
                            if (imgData) {
                                images.push(imgData);
                            }
                        } catch (imgError) {
                            console.log(`Aviso: Não foi possível extrair imagem na página ${pageNum}:`, imgError.message);
                        }
                    }
                }
            }
            
            await pdfDoc.destroy();
            
        } catch (error) {
            console.error('Erro ao extrair imagens com pdfjs:', error.message);
            
            // Fallback: tentar extrair com pdf-lib
            try {
                const fallbackImages = await this.extractImagesWithPdfLib(pdfBuffer);
                images.push(...fallbackImages);
            } catch (fallbackError) {
                console.error('Erro no fallback com pdf-lib:', fallbackError.message);
            }
        }
        
        return images;
    }
    
    /**
     * Extrai uma imagem específica de uma página
     */
    async extractImageFromPage(page, imgName, pageNum, imgIndex) {
        try {
            const objs = page.objs;
            
            // Esperar o objeto da imagem estar disponível
            const imgObj = await new Promise((resolve, reject) => {
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
            
            const { width, height, data, kind } = imgObj;
            
            if (!width || !height || !data) {
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
            let imageData = data;
            
            if (data.length !== expectedSize) {
                // Tentar ajustar o número de canais
                if (data.length === width * height * 3) {
                    channels = 3;
                    inputOptions = { raw: { width, height, channels: 3 } };
                } else if (data.length === width * height * 4) {
                    channels = 4;
                    inputOptions = { raw: { width, height, channels: 4 } };
                } else if (data.length === width * height) {
                    channels = 1;
                    inputOptions = { raw: { width, height, channels: 1 } };
                } else {
                    console.log(`Tamanho de dados inesperado: ${data.length}, esperado: ${expectedSize}`);
                    return null;
                }
            }
            
            // Converter para PNG
            const pngBuffer = await sharp(Buffer.from(imageData), inputOptions)
                .png()
                .toBuffer();
            
            const base64 = pngBuffer.toString('base64');
            
            return {
                id: `img_${pageNum}_${imgIndex}`,
                page: pageNum,
                width,
                height,
                format: 'png',
                mimeType: 'image/png',
                base64: base64,
                dataUrl: `data:image/png;base64,${base64}`,
                sizeBytes: pngBuffer.length
            };
            
        } catch (error) {
            console.log(`Erro ao processar imagem: ${error.message}`);
            return null;
        }
    }
    
    /**
     * Fallback: Extrai imagens usando pdf-lib
     */
    async extractImagesWithPdfLib(pdfBuffer) {
        const images = [];
        
        try {
            const pdfDoc = await PDFDocument.load(pdfBuffer);
            const pages = pdfDoc.getPages();
            
            let imageIndex = 0;
            
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
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
