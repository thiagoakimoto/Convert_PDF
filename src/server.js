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
        
        console.log(`✅ Extração: ${result.summary.totalPages} páginas, ${result.summary.totalImages} imagens`);
        
        // 2. Processar gabarito
        let gabarito_data = {};
        let gabaritoSource = 'nenhum';
        
        if (gabaritoFile) {
            console.log(`📋 Extraindo gabarito de: ${gabaritoFile.originalname}`);
            const gabaritoResult = await gabaritoExtractor.extractFromFile(gabaritoFile.path, true);
            gabarito_data = gabaritoResult.respostas || {};
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
        
        // 3. Resposta - data IDÊNTICO ao /extract (interface web) + gabarito separado
        res.json({
            success: true,
            filename: provaFile.originalname,
            data: result,
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
