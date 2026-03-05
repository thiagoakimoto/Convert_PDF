/**
 * Gemini Vision Analyzer
 * Usa a API do Gemini para analisar visualmente imagens extraídas de provas
 * e mapear cada imagem à sua respectiva questão com alta precisão.
 *
 * ESTRATÉGIA: envia o texto da página + as imagens recortadas diretamente ao Gemini.
 * Isso elimina a dependência de pdf-to-img / canvas nativo (problemático no Render).
 */

const { GoogleGenAI } = require('@google/genai');

class GeminiAnalyzer {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY não configurada');
        }
        this.ai = new GoogleGenAI({ apiKey });
        this.model = 'gemini-2.5-flash';
    }

    /**
     * Analisa uma página da prova usando Gemini Vision.
     * Recebe o texto extraído da página + as imagens já recortadas pelo pdfExtractor.
     *
     * @param {string}   pageText   - Texto extraído da página (contém "QUESTÃO 12", etc.)
     * @param {Array}    imagens    - Array de { id, dataUrl, mimeType } em ordem de cima p/ baixo
     * @param {number}   pageNumber - Número da página (para logs)
     * @returns {Promise<Object>}   - { texto_anotado, mapeamento: [{imagem, questao, idioma, local}] }
     */
    async analisarPagina(pageText, imagens, pageNumber) {
        if (!imagens || imagens.length === 0) {
            return { mapeamento: [] };
        }

        // Lista numerada para o prompt (ex: "Imagem 1: img_8_1")
        const listaImagensTexto = imagens
            .map((img, i) => `  - Imagem ${i + 1}: "${img.id}"`)
            .join('\n');

        const prompt = `<objetivo>
Você é um especialista em análise de provas de concurso (ENEM, OAB, FGV, CESPE).
Sua missão é mapear cada imagem recortada à questão correta desta página de prova.
</objetivo>

<contexto>
TEXTO COMPLETO DA PÁGINA ${pageNumber}:
---
${pageText}
---

IMAGENS RECORTADAS desta página (na ordem de cima para baixo, conforme aparecem no PDF):
${listaImagensTexto}

As imagens estão anexadas a esta mensagem na mesma ordem numérica acima.
Imagem 1 = primeiro inlineData, Imagem 2 = segundo inlineData, e assim por diante.
</contexto>

<instrucoes>
1. LEIA o texto da página para identificar os blocos de cada questão ("QUESTÃO 11", "QUESTÃO 12", etc.).
2. OBSERVE cada imagem anexada e identifique a qual questão ela pertence, usando:
   - A ordem visual (a imagem aparece logo abaixo do enunciado de qual questão?)
   - O texto de apoio (o enunciado menciona "observe a imagem", "na charge", etc.?)
   - O conteúdo visual da própria imagem (gráfico de qual tema? charge sobre o que?)
3. QUESTÕES 1-5 do ENEM podem ser de Inglês ou Espanhol: se for o caso, preencha "idioma".
4. ALTERNATIVAS COM IMAGENS: Algumas questões possuem imagens nas alternativas (A, B, C, D, E) em vez de texto. Indique exatamente onde a imagem está localizada usando o campo "local". O campo "local" deve ser preenchido como "enunciado", "alternativa_a", "alternativa_b", "alternativa_c", "alternativa_d" ou "alternativa_e".
5. LIXO VISUAL: logotipos, ícones, códigos de barra → "questao": null, "local": null.
6. REGRAS RIGOROSAS DE FORMATAÇÃO E IMAGENS: Ao ler a prova, se identificar uma figura, gráfico ou imagem no meio do texto, insira EXATAMENTE o marcador [IMAGEM_N] no local exato da aparição. O índice N corresponde à posição na lista fornecida (Imagem 1 → [IMAGEM_0], etc.).
    -LOCALIZAÇÃO CIRÚRGICA (ANCORAGEM): Você deve agir como um diagramador. Localize a última frase ANTES da imagem e a primeira frase DEPOIS da imagem. O marcador deve ficar exatamente entre elas.
    -FORMATO SANDWICH: Interrompa o texto para injetar a imagem. Ex: Texto inicial... [IMAGEM_0] ...continuação do texto.
    -HIERARQUIA DE ALTERNATIVAS: Se a imagem pertencer a uma alternativa, o marcador deve vir imediatamente após a letra. Ex: A) [IMAGEM_1]. Se a alternativa for apenas a imagem, o texto deve ser apenas o marcador.
    -CONTEXTO VISUAL VS OCR: Use sua visão computacional para "cortar" o texto do ${pageText} e injetar o marcador no ponto de interrupção visual observado nas imagens anexadas.
    -TRAVA DE UNICIDADE (ANTI-DUPLICAÇÃO): Gere o texto_anotado uma única vez por página. Não repita blocos de questões ou parágrafos. Se uma página for processada, todas as suas imagens e textos devem ser mesclados em um único fluxo contínuo e único.
    -DICA DE REFERÊNCIA: O marcador deve vir ANTES de fontes (Ex: "Disponível em:...") se a imagem estiver acima delas.

</instrucoes>

<limitacoes>
- Use SOMENTE os nomes de imagem da lista acima. Nunca invente nomes.
- Retorne APENAS um bloco JSON válido, sem texto adicional e sem markdown.
</limitacoes>

<saida>
{
  "texto_anotado": "QUESTÃO 12\nEste gráfico [IMAGEM_0] mostra a evolução do PIB...\nA) [IMAGEM_1]\nB) [IMAGEM_2]\nQUESTÃO 13\nA charge [IMAGEM_3] representa...",
  "mapeamento": [
    { "imagem": "img_8_1", "questao": 12, "idioma": null, "local": "enunciado" },
    { "imagem": "img_8_2", "questao": 12, "idioma": null, "local": "alternativa_a" },
    { "imagem": "img_8_3", "questao": 12, "idioma": null, "local": "alternativa_b" },
    { "imagem": "img_8_4", "questao": 13, "idioma": null, "local": "enunciado" }
  ]
}
</saida>`;

        // Montar parts: primeiro as imagens (na ordem), depois o prompt
        const parts = [];

        for (const img of imagens) {
            // dataUrl formato: "data:image/jpeg;base64,XXXXX"
            const commaIdx = img.dataUrl.indexOf(',');
            if (commaIdx === -1) continue;

            const header  = img.dataUrl.substring(0, commaIdx);   // "data:image/jpeg;base64"
            const base64  = img.dataUrl.substring(commaIdx + 1);  // os bytes
            const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';

            parts.push({
                inlineData: { mimeType, data: base64 }
            });
        }

        parts.push({ text: prompt });

        try {
            console.log(`🔍 Gemini analisando página ${pageNumber} (${imagens.length} imagem(ns))...`);

            const response = await this.ai.models.generateContent({
                model: this.model,
                contents: [{ role: 'user', parts }],
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.1
                }
            });

            const responseText = response.text;

            let resultado;
            try {
                resultado = JSON.parse(responseText);
            } catch {
                // Fallback: extrair bloco JSON de dentro de markdown, se vier
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    resultado = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error(`Resposta não é JSON: ${responseText.substring(0, 300)}`);
                }
            }

            console.log(`✅ Página ${pageNumber}: ${resultado.mapeamento?.length || 0} mapeamento(s)`);
            return resultado;

        } catch (error) {
            console.error(`❌ Erro Gemini página ${pageNumber}:`, error.message);

            // Fallback: retornar mapeamento com questao=null para não travar o fluxo
            return {
                mapeamento: imagens.map(img => ({
                    imagem: img.id,
                    questao: null,
                    idioma: null,
                    local: null,
                    erro: error.message
                }))
            };
        }
    }

    /**
     * Processa todas as páginas de uma prova e retorna mapeamento global.
     * Não precisa mais do caminho do PDF — usa apenas os dados já extraídos.
     * Também popula page.textoAnotado com o texto da página incluindo marcadores [IMAGEM_N].
     *
     * @param {Array} pagesData - Array de { pageNumber, text, images: [{id, dataUrl, mimeType}] }
     * @returns {Promise<Map>}  - Map: nome_imagem → { questao, idioma, local }
     */
    async processarProvaCompleta(pagesData) {
        const mapeamentoGlobal = new Map();
        const paginasComImagens = pagesData.filter(p => p.images && p.images.length > 0 && p.images.length <= 20);
        const paginasIgnoradas  = pagesData.filter(p => p.images && p.images.length > 20);

        if (paginasIgnoradas.length > 0) {
            console.log(`⚠️ Gemini: ignorando ${paginasIgnoradas.length} página(s) com muitas imagens (lixo visual): ${paginasIgnoradas.map(p => `pág ${p.pageNumber} (${p.images.length} imgs)`).join(', ')}`);
        }

        console.log(`\n🚀 Gemini: analisando ${paginasComImagens.length} página(s) em paralelo (lotes de 5)...\n`);

        const CONCORRENCIA = 5;

        for (let i = 0; i < paginasComImagens.length; i += CONCORRENCIA) {
            const lote = paginasComImagens.slice(i, i + CONCORRENCIA);

            await Promise.all(lote.map(async (page) => {
                const { pageNumber, text, images } = page;
                try {
                    const resultado = await this.analisarPagina(text || '', images, pageNumber);

                    if (resultado.texto_anotado) {
                        page.text = resultado.texto_anotado;
                    }

                    if (resultado.mapeamento) {
                        for (const item of resultado.mapeamento) {
                            mapeamentoGlobal.set(item.imagem, {
                                questao: item.questao ?? null,
                                idioma: item.idioma ?? null,
                                local: item.local ?? null
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Erro ao processar página ${pageNumber}:`, error.message);
                }
            }));
        }

        console.log(`\n✅ Gemini concluído: ${mapeamentoGlobal.size} imagem(ns) mapeada(s)\n`);
        return mapeamentoGlobal;
    }

    /**
     * Aplica o mapeamento retornado pelo Gemini nas imagens extraídas.
     * @param {Array} pages      - Array de páginas com imagens
     * @param {Map}   mapeamento - Map: nome_imagem → { questao, idioma, local }
     */
    aplicarMapeamento(pages, mapeamento) {
        for (const page of pages) {
            if (!page.images) continue;
            for (const img of page.images) {
                const mapping = mapeamento.get(img.id);
                img.questao = mapping ? mapping.questao : null;
                img.idioma  = mapping ? mapping.idioma  : null;
                img.local   = mapping ? mapping.local   : null;
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GeminiAnalyzer;
