const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const pdfExtractor = require('./pdfExtractor');
const fs = require('fs');

/**
 * Extrator de gabaritos de provas de concurso
 */
class GabaritoExtractor {
    
    /**
     * Detecta o tipo de arquivo (PDF ou Imagem) e processa adequadamente
     * @param {Buffer|String} fileBufferOrPath - Buffer da imagem ou caminho do arquivo
     * @param {Boolean} isFilePath - Se true, o primeiro parâmetro é um caminho de arquivo
     * @returns {Object} - Gabarito processado
     */
    async extractFromFile(fileBufferOrPath, isFilePath = false) {
        try {
            // Se recebeu path de arquivo
            if (isFilePath) {
                const filePath = fileBufferOrPath;
                
                // Detectar se é PDF pelo conteúdo
                const fileBuffer = fs.readFileSync(filePath);
                const isPDF = fileBuffer.toString('utf-8', 0, 5) === '%PDF-';
                
                if (isPDF) {
                    console.log('📄 Gabarito PDF - extraindo texto com pdfExtractor...');
                    const pdfData = await pdfExtractor.extractAll(filePath);
                    return this.parseGabaritoText(pdfData.fullText);
                } else {
                    console.log('🖼️ Gabarito imagem - processando OCR...');
                    return await this.extractFromImage(fileBuffer);
                }
            }
            
            // Se recebeu buffer, detectar tipo
            const fileBuffer = fileBufferOrPath;
            const isPDF = fileBuffer.toString('utf-8', 0, 5) === '%PDF-';
            
            if (isPDF) {
                // Salvar temporariamente para usar pdfExtractor
                const tempPath = `./uploads/temp-gabarito-${Date.now()}.pdf`;
                fs.writeFileSync(tempPath, fileBuffer);
                
                console.log('📄 Gabarito PDF detectado - extraindo texto com pdfExtractor...');
                const pdfData = await pdfExtractor.extractAll(tempPath);
                
                // Limpar arquivo temporário
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
                
                return this.parseGabaritoText(pdfData.fullText);
            } else {
                console.log('🖼️ Gabarito detectado como imagem - processando OCR...');
                return await this.extractFromImage(fileBuffer);
            }
        } catch (error) {
            console.error('Erro ao processar gabarito:', error);
            throw new Error(`Falha ao processar gabarito: ${error.message}`);
        }
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
