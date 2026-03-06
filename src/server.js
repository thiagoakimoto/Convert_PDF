require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pdfExtractor = require('./extractors/pdfExtractor');
const gabaritoExtractor = require('./extractors/gabaritoExtractor');
const questionParser = require('./extractors/questionParser');
const GeminiAnalyzer = require('./extractors/geminiAnalyzer');

// Inicializar Gemini se API key disponível
let geminiAnalyzer = null;
if (process.env.GEMINI_API_KEY) {
    try {
        geminiAnalyzer = new GeminiAnalyzer(process.env.GEMINI_API_KEY);
        console.log('✅ Gemini Vision inicializado com sucesso');
    } catch (err) {
        console.log('⚠️ Gemini não disponível:', err.message);
    }
} else {
    console.log('⚠️ GEMINI_API_KEY não configurada - usando fallback local');
}

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Tag imagens com suas respectivas questões - BASEADO NA ORDEM DE RENDERIZAÇÃO
 * 
 * A questão é detectada no extrator (pdfExtractor) baseado em:
 * - Posição da imagem no fluxo de operações do PDF
 * - Proporção de texto renderizado antes da imagem
 * - Isso determina a qual questão a imagem pertence
 * 
 * SEM PALAVRAS-CHAVE - apenas ordem de aparição
 */
function tagImagensComQuestao(pages) {
    console.log(`\n=== Tagging por ORDEM DE RENDERIZAÇÃO ===`);
    
    for (const page of pages) {
        const { pageNumber, images } = page;
        
        if (!images || images.length === 0) continue;
        
        console.log(`\nPág ${pageNumber}: ${images.length} imagens`);
        
        for (const img of images) {
            // Usar a questão detectada pelo extrator (baseado em flowRatio)
            img.questao = img.questaoDetectada || null;
            console.log(`  → ${img.id} → Q${img.questao} (flow=${img.flowOrder}, ratio=${((img.flowRatio||0)*100).toFixed(0)}%)`);
        }
    }
    
    console.log(`\n=== Tagging concluído ===\n`);
}

// Configuração do CORS
app.use(cors());
app.use(express.json({ limit: '500mb' })); // Aumentado para 500MB
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Servir arquivos estáticos (interface de teste)
app.use(express.static(path.join(__dirname, '../public')));

// Criar pasta de uploads se não existir
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/gif',
            'image/webp',
            'image/tiff'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Apenas arquivos PDF e imagens são permitidos!'), false);
        }
    },
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB max
    }
});

// Rota de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API de Extração de PDF funcionando!',
        timestamp: new Date().toISOString()
    });
});

// Rota principal - Extrair conteúdo e imagens do PDF
app.post('/extract', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF foi enviado'
            });
        }

        console.log(`📄 Processando PDF: ${req.file.originalname}`);
        
        const filePath = req.file.path;
        
        // Extrair conteúdo do PDF
        const result = await pdfExtractor.extractAll(filePath);
        
        // Limpar arquivo temporário
        fs.unlinkSync(filePath);
        
        console.log(`✅ Extração concluída: ${result.summary.totalImages} imagens encontradas em ${result.summary.totalPages} páginas`);
        
        res.json({
            success: true,
            filename: req.file.originalname,
            data: result
        });

    } catch (error) {
        console.error('❌ Erro ao processar PDF:', error);
        
        // Limpar arquivo em caso de erro
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar o PDF'
        });
    }
});

// Rota para extrair apenas imagens
app.post('/extract/images', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF foi enviado'
            });
        }

        console.log(`🖼️ Extraindo imagens de: ${req.file.originalname}`);
        
        const filePath = req.file.path;
        
        // Extrair apenas imagens
        const images = await pdfExtractor.extractImages(filePath);
        
        // Limpar arquivo temporário
        fs.unlinkSync(filePath);
        
        console.log(`✅ ${images.length} imagens extraídas`);
        
        res.json({
            success: true,
            filename: req.file.originalname,
            totalImages: images.length,
            images: images
        });

    } catch (error) {
        console.error('❌ Erro ao extrair imagens:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao extrair imagens'
        });
    }
});

// Rota para extrair texto por páginas
app.post('/extract/text', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF foi enviado'
            });
        }

        console.log(`📝 Extraindo texto de: ${req.file.originalname}`);
        
        const filePath = req.file.path;
        
        // Extrair texto
        const textData = await pdfExtractor.extractText(filePath);
        
        // Limpar arquivo temporário
        fs.unlinkSync(filePath);
        
        res.json({
            success: true,
            filename: req.file.originalname,
            data: textData
        });

    } catch (error) {
        console.error('❌ Erro ao extrair texto:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao extrair texto'
        });
    }
});

// Rota para processar PDF via base64 (útil para n8n)
app.post('/extract/base64', async (req, res) => {
    try {
        const { pdfBase64, filename } = req.body;
        
        if (!pdfBase64) {
            return res.status(400).json({
                success: false,
                error: 'Campo pdfBase64 é obrigatório'
            });
        }

        console.log(`📄 Processando PDF via base64: ${filename || 'sem nome'}`);
        
        // Converter base64 para buffer e salvar temporariamente
        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
        const tempPath = path.join(uploadDir, `${uuidv4()}.pdf`);
        fs.writeFileSync(tempPath, pdfBuffer);
        
        // Extrair conteúdo
        const result = await pdfExtractor.extractAll(tempPath);
        
        // Limpar arquivo temporário
        fs.unlinkSync(tempPath);
        
        console.log(`✅ Extração concluída: ${result.summary.totalImages} imagens encontradas em ${result.summary.totalPages} páginas`);
        
        res.json({
            success: true,
            filename: filename || 'pdf_base64',
            data: result
        });

    } catch (error) {
        console.error('❌ Erro ao processar PDF base64:', error);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar o PDF'
        });
    }
});

// Rota para converter páginas inteiras do PDF em imagens base64
app.post('/extract/pages-as-images', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhum arquivo PDF foi enviado'
            });
        }

        const dpi = parseInt(req.body.dpi) || 150;
        const format = req.body.format || 'png';

        console.log(`📄 Convertendo páginas para imagens: ${req.file.originalname}`);
        
        const filePath = req.file.path;
        
        // Converter páginas em imagens
        const pages = await pdfExtractor.convertPagesToImages(filePath, { dpi, format });
        
        // Limpar arquivo temporário
        fs.unlinkSync(filePath);
        
        console.log(`✅ ${pages.length} páginas convertidas para imagens`);
        
        res.json({
            success: true,
            filename: req.file.originalname,
            totalPages: pages.length,
            pages: pages
        });

    } catch (error) {
        console.error('❌ Erro ao converter páginas:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao converter páginas'
        });
    }
});

// ========================================
// ROTAS DE GABARITO
// ========================================

// Rota para processar gabarito via imagem (OCR)
app.post('/gabarito/extrair', upload.single('gabarito'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'Nenhuma imagem de gabarito foi enviada'
            });
        }

        console.log(`📋 Processando gabarito: ${req.file.originalname}`);
        
        const filePath = req.file.path;
        
        // Extrair gabarito (suporta PDF e imagens) - passa path diretamente
        const gabarito = await gabaritoExtractor.extractFromFile(filePath, true);
        
        // Limpar arquivo temporário
        fs.unlinkSync(filePath);
        
        console.log(`✅ Gabarito extraído: ${gabarito.totalQuestoes} questões`);
        
        res.json({
            success: true,
            filename: req.file.originalname,
            gabarito: gabarito
        });

    } catch (error) {
        console.error('❌ Erro ao processar gabarito:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar gabarito'
        });
    }
});

// Rota para processar gabarito manual (JSON)
app.post('/gabarito/manual', async (req, res) => {
    try {
        const { gabarito } = req.body;
        
        if (!gabarito) {
            return res.status(400).json({
                success: false,
                error: 'Campo "gabarito" é obrigatório'
            });
        }

        console.log(`📋 Processando gabarito manual`);
        
        const gabaritoProcessado = gabaritoExtractor.processManual(gabarito);
        
        console.log(`✅ Gabarito processado: ${gabaritoProcessado.totalQuestoes} questões`);
        
        res.json({
            success: true,
            gabarito: gabaritoProcessado
        });

    } catch (error) {
        console.error('❌ Erro ao processar gabarito manual:', error);
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar gabarito'
        });
    }
});

// ========================================
// ROTA PRINCIPAL: PROCESSAR PROVA COMPLETA (ASYNC/POLLING)
// ========================================

// Fila de jobs em memória
const jobs = new Map(); // jobId -> { status, result, error, createdAt }

// Limpeza automática de jobs antigos (>2h)
setInterval(() => {
    const limite = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of jobs) {
        if (new Date(job.createdAt).getTime() < limite) jobs.delete(id);
    }
}, 30 * 60 * 1000);

async function executarProcessamento(provaFile, gabaritoFile, gabaritoManual) {
    try {
        console.log(`\n🎯 Processando prova completa`);
        console.log(`📄 Prova: ${provaFile.originalname}`);
        if (gabaritoFile) console.log(`📋 Gabarito: ${gabaritoFile.originalname}`);

        // 1. Ler buffer da prova uma única vez
        console.log(`📄 Extraindo conteúdo da prova...`);
        const pdfBuffer = fs.readFileSync(provaFile.path);
        const fileSizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(1);
        console.log(`📄 Arquivo: ${fileSizeMB}MB`);

        const mem1 = process.memoryUsage();
        console.log(`💾 Memória inicial: RSS=${(mem1.rss/1024/1024).toFixed(0)}MB, Heap=${(mem1.heapUsed/1024/1024).toFixed(0)}MB`);

        // 2. Extrair APENAS TEXTO primeiro (baixo uso de memória)
        const textData = await pdfExtractor.extractTextFromBuffer(pdfBuffer);
        console.log(`📄 Texto extraído: ${textData.totalPages} páginas`);

        // 3. Filtrar páginas ANTES de extrair imagens (economia de memória)
        let filteredPages = textData.pages.filter(p => p.pageNumber > 1);

        const questionPattern = /(?:^|\n)\s*(?:Quest[aã]o\s+)?(\d{1,3})\s*\n/gi;
        const pageData = filteredPages.map(page => {
            questionPattern.lastIndex = 0;
            const nums = [];
            let m;
            while ((m = questionPattern.exec(page.text || '')) !== null) {
                const num = parseInt(m[1]);
                if (num > 0 && num <= 200) nums.push(num);
            }
            return { pageNumber: page.pageNumber, nums, text: page.text || '' };
        });

        let cutoffPage = Infinity;
        let runningMax = 0;

        for (const pd of pageData) {
            if (pd.nums.some(n => n > runningMax)) {
                for (const n of pd.nums) runningMax = Math.max(runningMax, n);
                continue;
            }
            if (/quest[õo]es?\s+discursivas?/i.test(pd.text)) continue;
            const restartNums = pd.nums.filter(n => n <= runningMax * 0.8);
            const alphaContent = pd.text.replace(/[^a-záéíóúàâêôãõçA-ZÁÉÍÓÚÀÂÊÔÃÕÇ]/g, '');

            if (restartNums.length >= 10 && alphaContent.length < 500 && runningMax > 20) {
                cutoffPage = pd.pageNumber;
                console.log(`📋 Folha de respostas detectada: pág ${cutoffPage} (${restartNums.length} números reiniciados, ${alphaContent.length} chars texto)`);
                break;
            }
        }

        if (cutoffPage !== Infinity) {
            console.log(`📋 Removendo folha de respostas a partir da página ${cutoffPage}`);
            filteredPages = filteredPages.filter(p => p.pageNumber < cutoffPage);
        }

        const discursiveIdx = filteredPages.findIndex(p => /quest[õo]es?\s+discursivas?/i.test(p.text || ''));
        if (discursiveIdx !== -1) {
            const removidas = filteredPages.length - discursiveIdx;
            const paginaInicio = filteredPages[discursiveIdx].pageNumber;
            filteredPages = filteredPages.slice(0, discursiveIdx);
            console.log(`📝 Removidas ${removidas} página(s) de questões discursivas (a partir da pág ${paginaInicio})`);
        }

        // 4. Extrair imagens apenas das páginas filtradas
        const keptPageNumbers = filteredPages.map(p => p.pageNumber);
        console.log(`📄 Extraindo imagens de ${keptPageNumbers.length} páginas (de ${textData.totalPages} total)...`);

        const mem2 = process.memoryUsage();
        console.log(`💾 Antes das imagens: RSS=${(mem2.rss/1024/1024).toFixed(0)}MB, Heap=${(mem2.heapUsed/1024/1024).toFixed(0)}MB`);

        const images = await pdfExtractor.extractImagesFromBuffer(pdfBuffer, {
            maxWidth: 800,
            pages: keptPageNumbers
        });

        // 5. Extrair metadata
        const metadata = await pdfExtractor.extractMetadata(pdfBuffer);

        // 6. Montar resultado
        const resultPages = filteredPages.map(page => {
            const pageImages = images.filter(img => img.page === page.pageNumber);
            return {
                pageNumber: page.pageNumber,
                text: page.text,
                characterCount: page.characterCount,
                images: pageImages,
                imageCount: pageImages.length,
                questionPositions: page.questionPositions || []
            };
        });

        const fullText = resultPages.map(p => p.text).join('\n\n');
        const totalImages = resultPages.reduce((sum, p) => sum + (p.images?.length || 0), 0);

        const result = {
            metadata,
            pages: resultPages,
            fullText,
            summary: {
                totalPages: resultPages.length,
                totalImages,
                totalCharacters: fullText.length,
                pagesWithImages: resultPages.filter(p => p.imageCount > 0).length
            }
        };

        const mem3 = process.memoryUsage();
        console.log(`💾 Memória final: RSS=${(mem3.rss/1024/1024).toFixed(0)}MB, Heap=${(mem3.heapUsed/1024/1024).toFixed(0)}MB`);
        console.log(`✅ Extração: ${result.summary.totalPages} páginas (skip pág 1), ${result.summary.totalImages} imagens`);

        // 7. Taguear imagens com Gemini ou fallback
        if (geminiAnalyzer) {
            try {
                console.log(`🤖 Usando Gemini Vision para tagging de imagens...`);
                const mapeamento = await geminiAnalyzer.processarProvaCompleta(result.pages);
                geminiAnalyzer.aplicarMapeamento(result.pages, mapeamento);
                console.log(`✅ Gemini: ${mapeamento.size} imagens mapeadas com sucesso`);
            } catch (geminiError) {
                console.error(`❌ Erro Gemini, usando fallback:`, geminiError.message);
                tagImagensComQuestao(result.pages);
            }
        } else {
            tagImagensComQuestao(result.pages);
        }
        console.log(`🏷️ Imagens tagueadas com número da questão`);

        // Limpar campos internos
        for (const page of result.pages) {
            delete page.questionPositions;
            for (const img of page.images || []) {
                delete img.yPos;
            }
        }

        // 8. Processar gabarito
        let gabarito_data = {};
        let textoGabarito = '';

        if (gabaritoFile) {
            console.log(`📋 Extraindo gabarito de: ${gabaritoFile.originalname}`);
            const gabaritoText = await pdfExtractor.extractText(gabaritoFile.path);
            textoGabarito = gabaritoText.pages.map(p => p.text).join('\n');
            console.log(`📋 Texto do gabarito: ${textoGabarito.length} chars (${gabaritoText.pages.length} páginas)`);

            const blocoMatch = textoGabarito.match(
                /(?:TIPO\s*1|Caderno\s*\d+)[^\n]*\n([\s\S]*?)(?=TIPO\s*2|Caderno\s*\d+|$)/i
            );

            let blocoGabarito;
            if (blocoMatch) {
                const temPares = /\b\d{1,3}\s+[A-E]\b/i.test(blocoMatch[1]);
                blocoGabarito = temPares ? blocoMatch[1] : textoGabarito;
                if (!temPares) console.log(`📋 Bloco isolado não contém pares Q-R, usando texto completo`);
            } else {
                blocoGabarito = textoGabarito;
            }

            const linhas = blocoGabarito.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            console.log(`📋 Bloco gabarito: ${linhas.length} linhas`);
            console.log(`📋 Primeiras 10 linhas: ${linhas.slice(0, 10).map((l, i) => `[${i}]="${l}"`).join(' | ')}`);

            // Estratégia 1: linhas de números seguidas por linhas de letras
            for (let i = 0; i < linhas.length - 1; i++) {
                if (!/^\d[\d\s]+\d$/.test(linhas[i])) continue;
                const numeros = linhas[i].match(/\d+/g);
                const letras = linhas[i + 1].match(/[A-E*]/gi);
                if (numeros && letras && numeros.length >= 3 && numeros.length === letras.length) {
                    for (let j = 0; j < numeros.length; j++) {
                        const resp = letras[j].toUpperCase();
                        gabarito_data[numeros[j]] = resp === '*' ? 'ANULADA' : resp;
                    }
                    i++;
                }
            }

            // Estratégia 2: pares número-letra intercalados
            if (Object.keys(gabarito_data).length === 0) {
                console.log(`📋 Estratégia 1 falhou, tentando pares número-letra...`);
                const allTokens = blocoGabarito.replace(/\n/g, ' ').match(/\S+/g) || [];
                for (let i = 0; i < allTokens.length - 1; i++) {
                    const num = parseInt(allTokens[i]);
                    const next = allTokens[i + 1];
                    if (num > 0 && num <= 200) {
                        if (/^[A-E*]$/i.test(next)) {
                            gabarito_data[String(num)] = next.toUpperCase() === '*' ? 'ANULADA' : next.toUpperCase();
                            i++;
                        } else if (/^anulad/i.test(next)) {
                            gabarito_data[String(num)] = 'ANULADA';
                            i++;
                        }
                    }
                }
            }

            // Estratégia 3: blocos separados
            if (Object.keys(gabarito_data).length === 0) {
                console.log(`📋 Estratégia 2 falhou, tentando blocos separados...`);
                const linhasNums = [];
                const linhasLetras = [];
                for (const l of linhas) {
                    if (/^\d[\d\s]+\d$/.test(l)) linhasNums.push(...l.match(/\d+/g));
                    else if (/^[A-E*][\sA-E*]+[A-E*]$/i.test(l)) linhasLetras.push(...l.match(/[A-E*]/gi));
                }
                if (linhasNums.length > 0 && linhasNums.length === linhasLetras.length) {
                    for (let j = 0; j < linhasNums.length; j++) {
                        const resp = linhasLetras[j].toUpperCase();
                        gabarito_data[linhasNums[j]] = resp === '*' ? 'ANULADA' : resp;
                    }
                }
            }

            // Estratégia 4: regex flexível
            if (Object.keys(gabarito_data).length === 0) {
                console.log(`📋 Estratégia 3 falhou, tentando regex flexível...`);
                const pares = blocoGabarito.matchAll(/\b(\d{1,3})\s+([A-E*]|Anulad[oa])\b/gi);
                for (const par of pares) {
                    const num = parseInt(par[1]);
                    if (num > 0 && num <= 200) {
                        const resp = par[2].toUpperCase();
                        gabarito_data[String(num)] = /^ANULAD/i.test(resp) ? 'ANULADA' : (resp === '*' ? 'ANULADA' : resp);
                    }
                }
            }

            console.log(`✅ Gabarito parseado: ${Object.keys(gabarito_data).length} respostas`);
            if (Object.keys(gabarito_data).length > 0) {
                const amostra = Object.entries(gabarito_data).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(', ');
                console.log(`📋 Amostra: ${amostra}...`);
            }
        } else if (gabaritoManual) {
            console.log(`📋 Processando gabarito manual`);
            const gabaritoResult = gabaritoExtractor.processManual(gabaritoManual);
            gabarito_data = gabaritoResult.respostas || {};
        }

        console.log(`✅ Processamento completo! Páginas: ${result.summary.totalPages}, Imagens: ${result.summary.totalImages}, Gabarito: ${Object.keys(gabarito_data).length} respostas\n`);

        // 9. Formatar resposta
        const gabaritoString = Object.keys(gabarito_data).length > 0
            ? Object.entries(gabarito_data)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([num, resp]) => `${num}: ${resp}`)
                .join(', ')
            : '';

        const response = {
            success: true,
            filename: provaFile.originalname,
            data: result,
            gabarito_data: gabaritoString
        };

        if (!gabaritoString && gabaritoFile) {
            response._debug_gabarito_texto = textoGabarito || 'texto não disponível';
        }

        return response;

    } finally {
        // Limpeza garantida mesmo em caso de erro
        if (provaFile && fs.existsSync(provaFile.path)) { try { fs.unlinkSync(provaFile.path); } catch(e) {} }
        if (gabaritoFile && fs.existsSync(gabaritoFile.path)) { try { fs.unlinkSync(gabaritoFile.path); } catch(e) {} }
    }
}

// POST /processar-prova-completa → retorna jobId imediatamente e processa em background
app.post('/processar-prova-completa', upload.any(), (req, res) => {
    const provaFile = req.files?.find(f =>
        ['prova', 'pdf', 'file', 'document'].includes(f.fieldname.toLowerCase())
    );
    const gabaritoFile = req.files?.find(f =>
        ['gabarito', 'answer', 'respostas', 'answers'].includes(f.fieldname.toLowerCase())
    );

    if (!provaFile) {
        const camposRecebidos = req.files?.map(f => f.fieldname).join(', ') || 'nenhum';
        return res.status(400).json({
            success: false,
            error: 'Arquivo da prova (PDF) é obrigatório',
            dica: 'Use o campo "prova" no form-data',
            camposAlternativos: ['prova', 'pdf', 'file', 'document'],
            camposRecebidos
        });
    }

    let gabaritoManual = null;
    try { gabaritoManual = req.body.gabarito ? JSON.parse(req.body.gabarito) : null; } catch(e) {}

    const jobId = uuidv4();
    jobs.set(jobId, { status: 'processing', createdAt: new Date() });

    console.log(`\n🎯 Job ${jobId} criado — processando em background...`);

    // Responde imediatamente com o jobId (evita timeout do Cloudflare)
    res.json({ success: true, jobId, status: 'processing' });

    // Processa em background
    executarProcessamento(provaFile, gabaritoFile, gabaritoManual)
        .then(result => {
            jobs.set(jobId, { status: 'done', result, createdAt: jobs.get(jobId)?.createdAt });
            console.log(`✅ Job ${jobId} concluído`);
        })
        .catch(error => {
            console.error(`❌ Job ${jobId} falhou:`, error.message);
            jobs.set(jobId, { status: 'error', error: error.message, createdAt: jobs.get(jobId)?.createdAt });
        });
});

// GET /job/:jobId → verifica status e retorna resultado quando pronto
app.get('/job/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ success: false, error: 'Job não encontrado ou já expirou' });
    }
    if (job.status === 'processing') {
        return res.json({ success: true, jobId, status: 'processing' });
    }
    if (job.status === 'error') {
        jobs.delete(jobId);
        return res.status(500).json({ success: false, jobId, status: 'error', error: job.error });
    }
    // done — retorna resultado e limpa da memória
    const { result } = job;
    jobs.delete(jobId);
    return res.json({ ...result, jobId, status: 'done' });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'Arquivo muito grande. Máximo permitido: 100MB'
            });
        }
    }
    
    res.status(500).json({
        success: false,
        error: error.message || 'Erro interno do servidor'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`
🚀 API de Extração de PDF iniciada!
📍 URL: http://localhost:${PORT}

🖥️  Interface de teste: http://localhost:${PORT}
    
📋 Endpoints disponíveis:
   
   EXTRAÇÃO BÁSICA:
   GET  /health                     - Status da API
   POST /extract                    - Extrair tudo (texto + imagens)
   POST /extract/images             - Extrair apenas imagens
   POST /extract/text               - Extrair apenas texto
   POST /extract/base64             - Processar PDF via base64
   POST /extract/pages-as-images    - Converter páginas em imagens
   
   GABARITO:
   POST /gabarito/extrair           - Extrair gabarito de imagem (OCR)
   POST /gabarito/manual            - Processar gabarito manual (JSON)
   
   🎯 COMPLETO (RECOMENDADO):
   POST /processar-prova-completa   - Inicia job async → retorna jobId
   GET  /job/:jobId                 - Verifica status e retorna resultado

📝 Para n8n: POST /processar-prova-completa → pega jobId → GET /job/:jobId até status=done
    `);
});

module.exports = app;
