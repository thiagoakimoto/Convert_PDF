/**
 * Parser inteligente de questões de provas de concurso
 * Detecta limites de questões, separa enunciado de alternativas,
 * associa imagens às questões corretas
 */
class QuestionParser {
    
    /**
     * Parseia as páginas extraídas do PDF em questões estruturadas
     * @param {Array} pages - [{pageNumber, text, images}]
     * @param {Object} options - {skipFirstPage: true}
     * @returns {Array} - [{numero, enunciado, alternativas, imagem_base64}]
     */
    parseProva(pages, options = {}) {
        const { skipFirstPage = true } = options;
        
        // 1. Filtrar páginas (skip page 1 = capa/instruções)
        const relevantPages = skipFirstPage 
            ? pages.filter(p => p.pageNumber > 1) 
            : pages;
        
        if (relevantPages.length === 0) return [];
        
        // 2. Construir texto combinado com rastreamento de posição por página
        let combinedText = '';
        const pageMarkers = [];
        
        for (const page of relevantPages) {
            const startPos = combinedText.length;
            combinedText += page.text + '\n\n';
            const endPos = combinedText.length;
            pageMarkers.push({
                page: page.pageNumber,
                startPos,
                endPos,
                images: page.images || []
            });
        }
        
        // 3. Encontrar limites de questões
        const boundaries = this.findQuestionBoundaries(combinedText);
        
        if (boundaries.length === 0) {
            console.log('⚠️ Nenhum padrão QUESTÃO XX encontrado. Usando fallback por página.');
            return this.fallbackParse(relevantPages);
        }
        
        console.log(`🔍 Encontradas ${boundaries.length} questões (${boundaries[0].numero} a ${boundaries[boundaries.length - 1].numero})`);
        
        // 4. Parsear cada questão
        const questions = [];
        
        for (let i = 0; i < boundaries.length; i++) {
            const boundary = boundaries[i];
            const nextBoundary = boundaries[i + 1];
            
            const contentStart = boundary.contentStart;
            const contentEnd = nextBoundary ? nextBoundary.index : combinedText.length;
            const rawContent = combinedText.substring(contentStart, contentEnd).trim();
            
            // Determinar páginas que esta questão ocupa
            const questionPages = this.getPagesForRange(
                boundary.index, contentEnd, pageMarkers
            );
            
            // Parsear enunciado e alternativas
            const { enunciado, alternativas } = this.parseQuestionContent(rawContent);
            
            // Coletar imagens das páginas da questão (filtrando pequenas)
            const questionImages = this.collectImagesForQuestion(questionPages, pageMarkers);
            const bestImage = this.selectBestImage(questionImages);
            
            questions.push({
                numero: boundary.numero,
                enunciado: this.cleanText(enunciado),
                alternativas: alternativas ? this.cleanAlternativas(alternativas) : null,
                imagem_base64: bestImage
            });
        }
        
        return questions;
    }
    
    /**
     * Encontra os limites de cada questão no texto combinado
     */
    findQuestionBoundaries(text) {
        const boundaries = [];
        
        // Padrão principal: QUESTÃO XX (FGV, CESPE, FCC, etc.)
        const mainPattern = /(?:^|\n)\s*QUEST[ÃA]O\s+(\d+)/gi;
        let match;
        
        while ((match = mainPattern.exec(text)) !== null) {
            boundaries.push({
                numero: parseInt(match[1]),
                index: match.index,
                fullMatch: match[0].trim(),
                contentStart: match.index + match[0].length
            });
        }
        
        // Se encontrou questões suficientes com o padrão principal, usar
        if (boundaries.length >= 3) {
            boundaries.sort((a, b) => a.index - b.index);
            return this.deduplicateBoundaries(boundaries);
        }
        
        // Padrão alternativo: "01)" ou "01." no início de linha
        const altPattern = /(?:^|\n)\s*(\d{1,3})\s*[.)]\s/g;
        const altBoundaries = [];
        
        while ((match = altPattern.exec(text)) !== null) {
            const numero = parseInt(match[1]);
            if (numero > 0 && numero <= 200) {
                altBoundaries.push({
                    numero,
                    index: match.index,
                    fullMatch: match[0].trim(),
                    contentStart: match.index + match[0].length
                });
            }
        }
        
        altBoundaries.sort((a, b) => a.index - b.index);
        
        // Verificar sequencialidade (mínimo 3 questões consecutivas)
        if (this.hasSequentialQuestions(altBoundaries, 3)) {
            return this.deduplicateBoundaries(altBoundaries);
        }
        
        // Retornar o que encontrar, ou vazio
        return boundaries.length > 0 
            ? this.deduplicateBoundaries(boundaries) 
            : [];
    }
    
    /**
     * Remove boundaries duplicados (mesmo número ou posição muito próxima)
     */
    deduplicateBoundaries(boundaries) {
        const unique = [];
        const seenNumbers = new Set();
        
        for (const b of boundaries) {
            if (!seenNumbers.has(b.numero)) {
                seenNumbers.add(b.numero);
                unique.push(b);
            }
        }
        
        return unique;
    }
    
    /**
     * Verifica se há questões em sequência numérica
     */
    hasSequentialQuestions(boundaries, minSequence) {
        if (boundaries.length < minSequence) return false;
        
        let sequential = 1;
        for (let i = 1; i < boundaries.length; i++) {
            if (boundaries[i].numero === boundaries[i - 1].numero + 1) {
                sequential++;
                if (sequential >= minSequence) return true;
            } else {
                sequential = 1;
            }
        }
        return false;
    }
    
    /**
     * Determina quais páginas um trecho do texto abrange
     */
    getPagesForRange(startPos, endPos, pageMarkers) {
        return pageMarkers
            .filter(m => m.endPos > startPos && m.startPos < endPos)
            .map(m => m.page);
    }
    
    /**
     * Parseia o conteúdo de uma questão em enunciado e alternativas
     */
    parseQuestionContent(rawText) {
        // Tentar padrão (A) (B) (C) (D) (E) - mais comum em provas FGV
        let altMatches = this.findAlternatives(rawText, /(?:^|\n)\s*\(([A-E])\)\s*/g);
        
        // Tentar A) B) C) D) E)
        if (!altMatches || altMatches.length < 3) {
            altMatches = this.findAlternatives(rawText, /(?:^|\n)\s*([A-E])\)\s*/g);
        }
        
        // Tentar (a) (b) (c) (d) (e) - minúsculo
        if (!altMatches || altMatches.length < 3) {
            altMatches = this.findAlternatives(rawText, /(?:^|\n)\s*\(([a-e])\)\s*/gi);
        }
        
        // Se achou alternativas, não exigir o "A" como primeiro - só pegar as que vierem
        if (altMatches && altMatches.length >= 2) {
            // Encontrar a primeira alternativa (de preferência A)
            const firstA = altMatches.find(m => m.letter === 'A');
            const startIndex = firstA ? firstA.index : altMatches[0].index;
            
            const enunciado = rawText.substring(0, startIndex).trim();
            const alternativas = {};
            
            // Extrair texto de cada alternativa
            const relevantAlts = altMatches.filter(m => m.index >= startIndex);
            
            for (let i = 0; i < relevantAlts.length; i++) {
                const start = relevantAlts[i].endIndex;
                const end = i + 1 < relevantAlts.length 
                    ? relevantAlts[i + 1].index 
                    : rawText.length;
                alternativas[relevantAlts[i].letter] = rawText.substring(start, end).trim();
            }
            
            return { enunciado, alternativas };
        }
        
        // Sem alternativas encontradas
        return { enunciado: rawText, alternativas: null };
    }
    
    /**
     * Encontra posições das alternativas no texto usando o pattern fornecido
     */
    findAlternatives(text, pattern) {
        const matches = [];
        let match;
        
        while ((match = pattern.exec(text)) !== null) {
            matches.push({
                letter: match[1].toUpperCase(),
                index: match.index,
                endIndex: match.index + match[0].length
            });
        }
        
        return matches.length >= 2 ? matches : null;
    }
    
    /**
     * Coleta imagens das páginas associadas à questão
     */
    collectImagesForQuestion(questionPages, pageMarkers) {
        const images = [];
        
        for (const pageNum of questionPages) {
            const marker = pageMarkers.find(m => m.page === pageNum);
            if (marker && marker.images) {
                images.push(...marker.images);
            }
        }
        
        return images;
    }
    
    /**
     * Seleciona a melhor imagem (maior área, excluindo logos/ícones pequenos)
     * @returns {string|null} - base64 da imagem ou null
     */
    selectBestImage(images) {
        if (!images || images.length === 0) return null;
        
        // Filtrar imagens muito pequenas (logos, ícones, separadores)
        const significantImages = images.filter(img => 
            img.width > 80 && img.height > 50
        );
        
        if (significantImages.length === 0) return null;
        
        // Selecionar a maior por área de pixels
        const best = significantImages.reduce((prev, curr) => {
            const prevArea = (prev.width || 0) * (prev.height || 0);
            const currArea = (curr.width || 0) * (curr.height || 0);
            return currArea > prevArea ? curr : prev;
        });
        
        return best.base64 || null;
    }
    
    /**
     * Limpa texto removendo \n desnecessários e espaços extras
     */
    cleanText(text) {
        if (!text) return '';
        
        return text
            .replace(/\r\n/g, '\n')                     // Normalizar line endings
            .replace(/\n{3,}/g, '\n\n')                  // Máximo 2 newlines
            .replace(/([^\n])\n([^\n])/g, '$1 $2')       // \n simples → espaço
            .replace(/([^\n])\n([^\n])/g, '$1 $2')       // Repetir para casos encadeados
            .replace(/\s{2,}/g, ' ')                      // Colapsar múltiplos espaços
            .trim();
    }
    
    /**
     * Limpa texto de cada alternativa
     */
    cleanAlternativas(alternativas) {
        if (!alternativas) return null;
        
        const cleaned = {};
        for (const [letter, text] of Object.entries(alternativas)) {
            cleaned[letter] = this.cleanText(text);
        }
        return cleaned;
    }
    
    /**
     * Fallback: quando não encontra padrão de questões
     * Parseia por página (uma "questão" por página)
     */
    fallbackParse(pages) {
        return pages.map(page => {
            const { enunciado, alternativas } = this.parseQuestionContent(page.text);
            const bestImage = this.selectBestImage(page.images || []);
            
            return {
                numero: page.pageNumber,
                enunciado: this.cleanText(enunciado),
                alternativas: alternativas ? this.cleanAlternativas(alternativas) : null,
                imagem_base64: bestImage
            };
        });
    }
}

module.exports = new QuestionParser();
