/**
 * Gemini Vision Analyzer
 * Usa a API do Gemini para analisar visualmente páginas de prova
 * e mapear imagens às suas respectivas questões com 100% de precisão
 */

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

class GeminiAnalyzer {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('GEMINI_API_KEY não configurada');
        }
        this.ai = new GoogleGenAI({ apiKey });
        this.model = 'gemini-2.0-flash'; // Mais rápido e barato
    }

    /**
     * Converte uma página específica do PDF em imagem PNG base64
     * Usa pdf-to-img que é baseada em pdfjs (sem dependências nativas)
     * @param {string} pdfPath - Caminho do arquivo PDF
     * @param {number} pageNumber - Número da página (1-indexed)
     * @returns {Promise<string>} - Imagem em base64 (sem prefixo data:)
     */
    async pdfPageToImage(pdfPath, pageNumber) {
        // Importar dinamicamente (ES module)
        const { pdf } = await import('pdf-to-img');
        
        const pdfBuffer = fs.readFileSync(pdfPath);
        
        let currentPage = 0;
        for await (const image of pdf(pdfBuffer, { scale: 2.0 })) {
            currentPage++;
            if (currentPage === pageNumber) {
                // image é um Buffer PNG
                return image.toString('base64');
            }
        }
        
        throw new Error(`Página ${pageNumber} não encontrada no PDF`);
    }

    /**
     * Analisa uma página da prova usando Gemini Vision
     * @param {string} pageImageBase64 - Imagem da página em base64
     * @param {string[]} nomesDasImagens - Lista de nomes das imagens recortadas na ordem
     * @param {number} pageNumber - Número da página (para debug)
     * @returns {Promise<Object>} - Mapeamento de imagens para questões
     */
    async analisarPagina(pageImageBase64, nomesDasImagens, pageNumber) {
        const prompt = `<objetivo>
Você atua como um Especialista em Visão Computacional e Processamento de Dados de Concursos.
Sua missão é analisar visualmente a imagem de uma página de prova do ENEM e mapear corretamente as imagens gráficas (charges, gráficos, tabelas) recortadas previamente pelo nosso sistema às suas respectivas questões.
</objetivo>

<contexto>
1. Imagem da Página: Fornecida em anexo (inlineData).
2. Imagens Recortadas: O nosso sistema já recortou as imagens desta página. Os nomes dos arquivos, listados na ordem exata em que aparecem de cima para baixo no layout, são:
${JSON.stringify(nomesDasImagens)}
</contexto>

<instrucoes>
1. ANÁLISE ESPACIAL E TEXTUAL:
   - Leia a página inteira visualmente, identificando os blocos de cada questão (ex: "QUESTÃO 12").
   - Identifique se o bloco da questão possui uma imagem gráfica renderizada logo abaixo do texto de apoio ou se o enunciado faz referência direta a uma figura ("Observe a imagem", "Na charge").

2. MAPEAMENTO:
   - Atribua o nome do arquivo da imagem correspondente à questão correta.
   - Siga a ordem: a primeira imagem visualizada na página corresponde ao primeiro nome da lista de "Imagens Recortadas", e assim por diante.

3. TRATAMENTO DO INGLÊS/ESPANHOL (REGRA DO ENEM):
   - O ENEM repete a numeração das questões de 1 a 5 (Inglês e Espanhol).
   - Se a imagem pertencer a uma questão entre 1 e 5, você DEVE preencher o campo "idioma" no JSON indicando a qual prova ela pertence, lendo o cabeçalho acima dela.
   - Se for da questão 6 em diante, o campo "idioma" deve ser null.

4. LIXO VISUAL:
   - Se houver nomes na lista de imagens que parecem ser apenas logotipos, ícones de cadernos ou códigos de barras (não pertencem a nenhuma questão), atribua o valor "numero_questao": null para eles.
</instrucoes>

<limitacoes>
- NUNCA invente nomes de imagens que não estão na lista fornecida.
- NUNCA tente resolver a questão.
- A saída deve ser EXCLUSIVAMENTE um bloco JSON válido, sem textos introdutórios ou marcações Markdown (sem \`\`\`json).
</limitacoes>

<saida>
Retorne APENAS um JSON com a seguinte estrutura:
{
  "mapeamento": [
    {
      "nome_imagem": "img_8_1",
      "numero_questao": 4,
      "idioma": "Espanhol" 
    },
    {
      "nome_imagem": "img_8_2",
      "numero_questao": 14,
      "idioma": null
    },
    {
      "nome_imagem": "img_8_3",
      "numero_questao": null,
      "idioma": null
    }
  ]
}
</saida>`;

        try {
            console.log(`🔍 Gemini analisando página ${pageNumber} (${nomesDasImagens.length} imagens)...`);
            
            const response = await this.ai.models.generateContent({
                model: this.model,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                inlineData: {
                                    mimeType: 'image/png',
                                    data: pageImageBase64
                                }
                            },
                            {
                                text: prompt
                            }
                        ]
                    }
                ],
                config: {
                    responseMimeType: 'application/json',
                    temperature: 0.1
                }
            });

            const responseText = response.text;
            
            // Parsear JSON da resposta
            let resultado;
            try {
                resultado = JSON.parse(responseText);
            } catch (parseError) {
                // Tentar extrair JSON de markdown se necessário
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    resultado = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error(`Resposta inválida do Gemini: ${responseText.substring(0, 200)}`);
                }
            }

            console.log(`✅ Página ${pageNumber}: ${resultado.mapeamento?.length || 0} mapeamentos`);
            
            return resultado;

        } catch (error) {
            console.error(`❌ Erro Gemini página ${pageNumber}:`, error.message);
            
            // Fallback: retornar mapeamento vazio
            return {
                mapeamento: nomesDasImagens.map(nome => ({
                    nome_imagem: nome,
                    numero_questao: null,
                    idioma: null,
                    erro: error.message
                }))
            };
        }
    }

    /**
     * Processa todas as páginas de uma prova e retorna mapeamento completo
     * @param {string} pdfPath - Caminho do PDF
     * @param {Object} pagesData - Dados das páginas com imagens extraídas
     * @returns {Promise<Map>} - Map de nome_imagem → {questao, idioma}
     */
    async processarProvaCompleta(pdfPath, pagesData) {
        const mapeamentoGlobal = new Map();
        
        console.log(`\n🚀 Iniciando análise Gemini de ${pagesData.length} páginas...\n`);
        
        for (const page of pagesData) {
            const { pageNumber, images } = page;
            
            // Pular páginas sem imagens
            if (!images || images.length === 0) continue;
            
            // Lista de nomes das imagens na ordem
            const nomesDasImagens = images.map(img => img.id);
            
            try {
                // Converter página para imagem
                const pageImageBase64 = await this.pdfPageToImage(pdfPath, pageNumber);
                
                // Analisar com Gemini
                const resultado = await this.analisarPagina(pageImageBase64, nomesDasImagens, pageNumber);
                
                // Adicionar ao mapeamento global
                if (resultado.mapeamento) {
                    for (const item of resultado.mapeamento) {
                        mapeamentoGlobal.set(item.nome_imagem, {
                            questao: item.numero_questao,
                            idioma: item.idioma
                        });
                    }
                }
                
                // Rate limiting: 60 req/min = 1 req/segundo
                await this.sleep(1000);
                
            } catch (error) {
                console.error(`Erro ao processar página ${pageNumber}:`, error.message);
            }
        }
        
        console.log(`\n✅ Análise completa: ${mapeamentoGlobal.size} imagens mapeadas\n`);
        
        return mapeamentoGlobal;
    }

    /**
     * Aplica o mapeamento do Gemini nas imagens extraídas
     * @param {Array} pages - Array de páginas com imagens
     * @param {Map} mapeamento - Mapeamento nome_imagem → {questao, idioma}
     */
    aplicarMapeamento(pages, mapeamento) {
        for (const page of pages) {
            if (!page.images) continue;
            
            for (const img of page.images) {
                const mapping = mapeamento.get(img.id);
                if (mapping) {
                    img.questao = mapping.questao;
                    img.idioma = mapping.idioma;
                } else {
                    img.questao = null;
                    img.idioma = null;
                }
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = GeminiAnalyzer;
