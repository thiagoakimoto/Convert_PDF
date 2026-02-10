const Tesseract = require('tesseract.js');
const sharp = require('sharp');

/**
 * Extrator de gabaritos de provas de concurso
 */
class GabaritoExtractor {
    
    /**
     * Detecta o tipo de arquivo (PDF ou Imagem) e processa adequadamente
     * @param {Buffer} fileBuffer - Buffer do arquivo (PDF ou imagem)
     * @returns {Object} - Gabarito processado
     */
    async extractFromFile(fileBuffer) {
        try {
            // Detectar tipo de arquivo pelos magic bytes
            const isPDF = fileBuffer.toString('utf-8', 0, 5) === '%PDF-';
            
            if (isPDF) {
                console.log('📄 Gabarito detectado como PDF - extraindo texto...');
                const texto = await this.extractTextFromPdf(fileBuffer);
                return this.parseGabaritoText(texto);
            } else {
                console.log('🖼️ Gabarito detectado como imagem - processando OCR...');
                return await this.extractFromImage(fileBuffer);
            }
        } catch (error) {
            console.error('Erro ao detectar tipo de arquivo:', error);
            
            // Não tenta OCR se o arquivo for PDF (Tesseract não suporta PDF)
            const isPDF = fileBuffer.toString('utf-8', 0, 5) === '%PDF-';
            if (isPDF) {
                throw new Error('Não foi possível processar o gabarito em PDF. O arquivo pode estar corrompido ou protegido. Tente converter para imagem (PNG/JPG) ou usar gabarito manual em JSON.');
            }
            
            // Tenta processar como imagem (fallback)
            return await this.extractFromImage(fileBuffer);
        }
    }
    
    /**
     * Extrai texto de PDF usando pdfjs
     * @param {Buffer} pdfBuffer - Buffer do PDF
     * @returns {String} - Texto extraído
     */
    async extractTextFromPdf(pdfBuffer) {
        try {
            const pdfjs = await this.getPdfjs();
            // Converter Buffer para Uint8Array (requerido pelo pdfjs)
            const uint8Array = new Uint8Array(pdfBuffer);
            const loadingTask = pdfjs.getDocument({ data: uint8Array });
            const pdf = await loadingTask.promise;
            
            let fullText = '';
            
            // Extrair texto de todas as páginas (gabaritos podem ter múltiplas páginas)
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n';
            }
            
            console.log(`✅ Texto extraído do PDF: ${fullText.length} caracteres`);
            return fullText;
            
        } catch (error) {
            console.error('Erro ao extrair texto do PDF:', error);
            throw new Error('Não foi possível extrair texto do PDF. Verifique se o arquivo é um PDF válido.');
        }
    }
    
    /**
     * Obtém instância do pdfjs com suport a ESM
     */
    async getPdfjs() {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        return pdfjs;
    }
    
    /**
     * Processa imagem de gabarito e extrai as respostas
     * @param {Buffer} imageBuffer - Buffer da imagem do gabarito
     * @returns {Object} - Gabarito processado
     */
    async extractFromImage(imageBuffer) {
        try {
            // Pré-processar imagem para melhorar OCR
            const processedImage = await this.preprocessImage(imageBuffer);
            
            // Executar OCR
            const { data: { text } } = await Tesseract.recognize(
                processedImage,
                'por',
                {
                    logger: m => console.log(m)
                }
            );
            
            // Extrair gabarito do texto
            const gabarito = this.parseGabaritoText(text);
            
            return gabarito;
            
        } catch (error) {
            console.error('Erro ao extrair gabarito:', error);
            throw error;
        }
    }
    
    /**
     * Pré-processa imagem para melhorar OCR
     */
    async preprocessImage(imageBuffer) {
        try {
            const processed = await sharp(imageBuffer)
                .grayscale()
                .normalize()
                .sharpen()
                .threshold(128)
                .toBuffer();
            
            return processed;
        } catch (error) {
            // Se falhar, retorna original
            return imageBuffer;
        }
    }
    
    /**
     * Faz parse do texto extraído e identifica questões e respostas
     */
    parseGabaritoText(text) {
        const gabarito = {};
        
        // Padrões comuns de gabarito
        // Ex: "01 A", "1-A", "01: A", "QUESTÃO 01 - A"
        const patterns = [
            /(\d+)\s*[-:.]?\s*([A-E])/gi,
            /questão\s*(\d+)\s*[-:.]?\s*([A-E])/gi,
            /q\s*(\d+)\s*[-:.]?\s*([A-E])/gi
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const questao = parseInt(match[1]);
                const resposta = match[2].toUpperCase();
                
                if (questao > 0 && questao <= 100 && /[A-E]/.test(resposta)) {
                    gabarito[questao] = resposta;
                }
            }
        }
        
        return {
            respostas: gabarito,
            totalQuestoes: Object.keys(gabarito).length,
            textoOriginal: text
        };
    }
    
    /**
     * Processa gabarito manual (JSON estruturado)
     * @param {Object} gabaritoManual - Objeto com questões e respostas
     */
    processManual(gabaritoManual) {
        const gabarito = {};
        
        // Aceita formato: { "1": "A", "2": "B", ... }
        // ou Array: [{ questao: 1, resposta: "A" }]
        
        if (Array.isArray(gabaritoManual)) {
            gabaritoManual.forEach(item => {
                if (item.questao && item.resposta) {
                    gabarito[item.questao] = item.resposta.toUpperCase();
                }
            });
        } else {
            Object.keys(gabaritoManual).forEach(questao => {
                const num = parseInt(questao);
                const resposta = gabaritoManual[questao];
                
                if (num > 0 && /[A-E]/i.test(resposta)) {
                    gabarito[num] = resposta.toUpperCase();
                }
            });
        }
        
        return {
            respostas: gabarito,
            totalQuestoes: Object.keys(gabarito).length
        };
    }
    
    /**
     * Faz match automático entre questões extraídas e gabarito
     * @param {Array} questoes - Array de questões extraídas do PDF
     * @param {Object} gabarito - Gabarito processado
     */
    matchQuestoesComGabarito(questoes, gabarito) {
        const questoesComGabarito = questoes.map(questao => {
            const respostaCorreta = gabarito.respostas[questao.pageNumber] || 
                                   gabarito.respostas[questao.numero] ||
                                   null;
            
            return {
                ...questao,
                respostaCorreta,
                temResposta: respostaCorreta !== null
            };
        });
        
        const stats = {
            totalQuestoes: questoes.length,
            questoesComResposta: questoesComGabarito.filter(q => q.temResposta).length,
            questoesSemResposta: questoesComGabarito.filter(q => !q.temResposta).length,
            percentualMatch: Math.round((questoesComGabarito.filter(q => q.temResposta).length / questoes.length) * 100)
        };
        
        return {
            questoes: questoesComGabarito,
            stats,
            gabarito: gabarito.respostas
        };
    }
    
    /**
     * Detecta automaticamente número da questão no texto
     */
    detectarNumeroQuestao(textoQuestao, pageNumber) {
        // Tenta encontrar padrões como "QUESTÃO 01", "01)", "01.", "Q.01"
        const patterns = [
            /questão\s*(\d+)/i,
            /q\.?\s*(\d+)/i,
            /^(\d+)[.)]/m,
            /(\d+)\s*[-–—]/
        ];
        
        for (const pattern of patterns) {
            const match = textoQuestao.match(pattern);
            if (match) {
                return parseInt(match[1]);
            }
        }
        
        // Se não encontrar, usa o número da página
        return pageNumber;
    }
}

module.exports = new GabaritoExtractor();
