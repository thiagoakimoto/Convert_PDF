const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const pdfExtractor = require('./extractors/pdfExtractor');
const gabaritoExtractor = require('./extractors/gabaritoExtractor');
const questionParser = require('./extractors/questionParser');

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Reorganiza páginas em questões individuais com imagens associadas.
 * Simples: detecta números de questão, corta texto, distribui imagens por ordem.
 */
function splitPagesIntoQuestions(pages) {
    // 1. Primeiro passo: coletar TODAS as questões de todas as páginas
    const rawBoundaries = [];
    
    for (const page of pages) {
        const text = page.text;
        const pattern = /(?:^|\n)\s*(?:Quest[aã]o\s+)?(\d{1,3})\s*\n/gi;
        let match;
        
        while ((match = pattern.exec(text)) !== null) {
            const numero = parseInt(match[1]);
            if (numero > 0 && numero <= 200) {
                rawBoundaries.push({
                    numero,
                    pageNumber: page.pageNumber,
                    index: match.index
                });
            }
        }
    }
    
    // 2. Detectar onde a numeração REINICIA (folhas de resposta/discursivas)
    //    Ex: questões 1→65 e depois volta pro 1 = páginas depois do restart são lixo
    let maxNumeroVisto = 0;
    let cutoffPage = Infinity;
    
    for (const b of rawBoundaries) {
        if (b.numero <= maxNumeroVisto - 10 && maxNumeroVisto > 20) {
            // Numeração reiniciou — tudo a partir desta página é folha de resposta
            cutoffPage = b.pageNumber;
            console.log(`📋 Detectada folha de respostas a partir da página ${cutoffPage} (ignorando)`);
            break;
        }
        maxNumeroVisto = Math.max(maxNumeroVisto, b.numero);
    }
    
    // 3. Filtrar páginas úteis (antes do cutoff)
    const pagesUteis = pages.filter(p => p.pageNumber < cutoffPage);
    
    // 4. Para cada página útil, dividir texto por questão e associar imagens
    const questoes = [];
    
    for (const page of pagesUteis) {
        const text = page.text;
        const images = page.images || [];
        
        // Encontrar limites de questões nesta página
        const pattern = /(?:^|\n)\s*(?:Quest[aã]o\s+)?(\d{1,3})\s*\n/gi;
        const bounds = [];
        let match;
        
        while ((match = pattern.exec(text)) !== null) {
            const numero = parseInt(match[1]);
            if (numero > 0 && numero <= 200) {
                // Evitar duplicatas
                if (bounds.length === 0 || bounds[bounds.length - 1].numero !== numero) {
                    bounds.push({ numero, index: match.index });
                }
            }
        }
        
        if (bounds.length === 0) {
            // Página sem questão (texto de apoio, cabeçalho etc) — incluir com imagens
            if (text.trim().length > 30) {
                questoes.push({ numero: null, pagina: page.pageNumber, texto: text, imagens: images });
            }
            continue;
        }
        
        // Cortar texto de cada questão
        const questoesPagina = [];
        for (let i = 0; i < bounds.length; i++) {
            const start = bounds[i].index;
            const end = i + 1 < bounds.length ? bounds[i + 1].index : text.length;
            questoesPagina.push({
                numero: bounds[i].numero,
                texto: text.substring(start, end).trim()
            });
        }
        
        // Associar imagens: distribuir na ordem para quem referencia
        const imagensDisponiveis = [...images];
        const imagensPorQuestao = new Map();
        questoesPagina.forEach(q => imagensPorQuestao.set(q.numero, []));
        
        const IMG_KEYWORDS = /imagem|figura|observe|analise|gr[aá]fico|tabela|quadro|mapa|ilustra|retratad|seguir|foto|reprodu[çcz]|cena|obra|pintura/i;
        
        if (questoesPagina.length === 1) {
            // Única questão na página → todas as imagens são dela
            imagensPorQuestao.set(questoesPagina[0].numero, imagensDisponiveis);
        } else if (imagensDisponiveis.length > 0) {
            // Múltiplas questões → distribuir imagens na ordem para quem referencia
            for (const q of questoesPagina) {
                if (imagensDisponiveis.length === 0) break;
                if (IMG_KEYWORDS.test(q.texto)) {
                    // Essa questão referencia imagem — pega a próxima disponível
                    imagensPorQuestao.get(q.numero).push(imagensDisponiveis.shift());
                }
            }
            // Imagens sobrando → jogar na última questão que referencia imagem, ou na última questão
            if (imagensDisponiveis.length > 0) {
                const lastQ = questoesPagina[questoesPagina.length - 1].numero;
                imagensPorQuestao.get(lastQ).push(...imagensDisponiveis);
            }
        }
        
        // Montar resultado
        for (const q of questoesPagina) {
            questoes.push({
                numero: q.numero,
                pagina: page.pageNumber,
                texto: q.texto,
                imagens: imagensPorQuestao.get(q.numero) || []
            });
        }
    }
    
    return questoes;
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
// ROTA PRINCIPAL: PROCESSAR PROVA COMPLETA
// ========================================

// Processa prova (PDF) + gabarito (PDF/imagem ou JSON) e retorna formato estruturado
app.post('/processar-prova-completa', upload.any(), async (req, res) => {
    try {
        // Buscar arquivo da prova com nomes alternativos
        const provaFile = req.files?.find(f => 
            ['prova', 'pdf', 'file', 'document'].includes(f.fieldname.toLowerCase())
        );
        
        // Buscar arquivo do gabarito com nomes alternativos
        const gabaritoFile = req.files?.find(f => 
            ['gabarito', 'answer', 'respostas', 'answers'].includes(f.fieldname.toLowerCase())
        );
        
        // Validar arquivo da prova
        if (!provaFile) {
            const camposRecebidos = req.files?.map(f => f.fieldname).join(', ') || 'nenhum';
            
            return res.status(400).json({
                success: false,
                error: 'Arquivo da prova (PDF) é obrigatório',
                dica: 'Use o campo "prova" no form-data',
                camposAlternativos: ['prova', 'pdf', 'file', 'document'],
                camposRecebidos: camposRecebidos
            });
        }

        console.log(`\n🎯 Processando prova completa`);
        console.log(`📄 Prova: ${provaFile.originalname} (campo: ${provaFile.fieldname})`);
        if (gabaritoFile) {
            console.log(`📋 Gabarito: ${gabaritoFile.originalname} (campo: ${gabaritoFile.fieldname})`);
        }
        
        const gabaritoManual = req.body.gabarito ? JSON.parse(req.body.gabarito) : null;
        
        // 1. Extrair conteúdo do PDF - MESMA função da interface web (extractAll)
        console.log(`📄 Extraindo conteúdo da prova...`);
        const result = await pdfExtractor.extractAll(provaFile.path);
        
        // Remover página 1 (capa/instruções) do resultado
        result.pages = result.pages.filter(p => p.pageNumber > 1);
        result.allImages = result.pages.flatMap(p => p.images || []);
        result.summary.totalPages = result.pages.length;
        result.summary.totalImages = result.allImages.length;
        result.summary.totalCharacters = result.pages.reduce((s, p) => s + p.characterCount, 0);
        result.summary.pagesWithImages = result.pages.filter(p => (p.images || []).length > 0).length;
        result.fullText = result.pages.map(p => p.text).join('\n\n');
        
        console.log(`✅ Extração: ${result.summary.totalPages} páginas (skip pág 1), ${result.summary.totalImages} imagens`);
        
        // 2. Reorganizar por questão (com imagens associadas à questão correta)
        const questoes = splitPagesIntoQuestions(result.pages);
        console.log(`📝 Questões detectadas: ${questoes.filter(q => q.numero !== null).length}`);
        
        // 3. Processar gabarito
        let gabarito_data = {};
        let gabaritoSource = 'nenhum';
        
        if (gabaritoFile) {
            console.log(`📋 Extraindo gabarito de: ${gabaritoFile.originalname}`);
            // Extrair apenas texto da primeira página do gabarito, sem modificação
            const gabaritoText = await pdfExtractor.extractText(gabaritoFile.path);
            const primeiraPagina = gabaritoText.pages[0];
            gabarito_data = primeiraPagina ? primeiraPagina.text : '';
            gabaritoSource = gabaritoFile.originalname;
            
            if (fs.existsSync(gabaritoFile.path)) fs.unlinkSync(gabaritoFile.path);
        } else if (gabaritoManual) {
            console.log(`📋 Processando gabarito manual`);
            const gabaritoResult = gabaritoExtractor.processManual(gabaritoManual);
            gabarito_data = gabaritoResult.respostas || {};
            gabaritoSource = 'manual';
        }
        
        // Limpar arquivo da prova
        if (fs.existsSync(provaFile.path)) fs.unlinkSync(provaFile.path);
        
        console.log(`✅ Processamento completo!`);
        console.log(`   Páginas: ${result.summary.totalPages}`);
        console.log(`   Imagens: ${result.summary.totalImages}`);
        console.log(`   Gabarito: ${Object.keys(gabarito_data).length} respostas\n`);
        
        // 4. Resposta - data do extractAll + questões com imagens associadas + gabarito
        res.json({
            success: true,
            filename: provaFile.originalname,
            data: result,
            questoes,
            gabarito_data
        });

    } catch (error) {
        console.error('❌ Erro ao processar prova completa:', error);
        
        // Limpar arquivos em caso de erro
        if (req.files) {
            for (const file of req.files) {
                if (fs.existsSync(file.path)) {
                    try { fs.unlinkSync(file.path); } catch(e) {}
                }
            }
        }
        
        res.status(500).json({
            success: false,
            error: error.message || 'Erro ao processar prova completa'
        });
    }
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
   POST /processar-prova-completa   - PDF + Gabarito → Match automático!

📝 Para n8n: Use /processar-prova-completa com multipart/form-data
   Campos: prova (PDF) + gabarito (imagem ou JSON)
    `);
});

module.exports = app;
