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
 * Adiciona campo "questao" em cada imagem indicando a qual questão pertence.
 * Simples: detecta questões na página, distribui imagens por ordem.
 */
function tagImagensComQuestao(pages) {
    const IMG_KEYWORDS = /imagem|figura|observe|analise|gr[aá]fico|tabela|quadro|mapa|ilustra|retratad|seguir|foto|reprodu[çcz]|cena|obra|pintura/i;
    
    for (const page of pages) {
        const text = page.text || '';
        const images = page.images || [];
        if (images.length === 0) continue;
        
        // Detectar questões na página
        const pattern = /(?:^|\n)\s*(?:Quest[aã]o\s+)?(\d{1,3})\s*\n/gi;
        const bounds = [];
        let match;
        
        while ((match = pattern.exec(text)) !== null) {
            const numero = parseInt(match[1]);
            if (numero > 0 && numero <= 200) {
                if (bounds.length === 0 || bounds[bounds.length - 1].numero !== numero) {
                    bounds.push({ numero, index: match.index });
                }
            }
        }
        
        if (bounds.length === 0) {
            // Sem questão detectada — marcar imagens como página
            images.forEach(img => { img.questao = null; });
            continue;
        }
        
        if (bounds.length === 1) {
            // Única questão → todas as imagens são dela
            images.forEach(img => { img.questao = bounds[0].numero; });
            continue;
        }
        
        // Múltiplas questões → pegar o texto de cada uma e ver quem referencia imagem
        const questoesTexto = bounds.map((b, i) => {
            const start = b.index;
            const end = i + 1 < bounds.length ? bounds[i + 1].index : text.length;
            return { numero: b.numero, texto: text.substring(start, end) };
        });
        
        // Distribuir imagens na ordem para quem referencia
        const imgQueue = [...images];
        const assigned = new Set();
        
        for (const q of questoesTexto) {
            if (imgQueue.length === 0) break;
            if (IMG_KEYWORDS.test(q.texto)) {
                const img = imgQueue.shift();
                img.questao = q.numero;
                assigned.add(img);
            }
        }
        
        // Imagens não atribuídas → dar pra última questão com referência, ou última questão
        const lastQComRef = [...questoesTexto].reverse().find(q => IMG_KEYWORDS.test(q.texto));
        const fallbackNumero = lastQComRef ? lastQComRef.numero : bounds[bounds.length - 1].numero;
        
        for (const img of imgQueue) {
            img.questao = fallbackNumero;
        }
        
        // Marcar as que não foram tocadas
        images.filter(img => img.questao === undefined).forEach(img => { img.questao = fallbackNumero; });
    }
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
        
        // Detectar e remover folhas de respostas (numeração reinicia)
        // Abordagem em 2 passadas para evitar falsos positivos com números de fórmulas/frações
        const questionPattern = /(?:^|\n)\s*(?:Quest[aã]o\s+)?(\d{1,3})\s*\n/gi;
        
        // Passo 1: coletar números detectados em cada página
        const pageData = result.pages.map(page => {
            questionPattern.lastIndex = 0;
            const nums = [];
            let m;
            while ((m = questionPattern.exec(page.text || '')) !== null) {
                const num = parseInt(m[1]);
                if (num > 0 && num <= 200) nums.push(num);
            }
            return { pageNumber: page.pageNumber, nums, text: page.text || '' };
        });
        
        // Passo 2: detectar folha de respostas com critérios mais rigorosos
        let cutoffPage = Infinity;
        let runningMax = 0;
        
        for (const pd of pageData) {
            // Se a página tem algum número que continua a sequência crescente, atualizar e prosseguir
            if (pd.nums.some(n => n > runningMax)) {
                for (const n of pd.nums) runningMax = Math.max(runningMax, n);
                continue;
            }
            
            // Página não continua a sequência — verificar se é folha de respostas
            // Pular se contém conteúdo de questões discursivas
            if (/quest[õo]es?\s+discursivas?/i.test(pd.text)) continue;
            
            // Contar números de "reinício" (muito abaixo do máximo atual)
            const restartNums = pd.nums.filter(n => n <= runningMax * 0.8);
            
            // Medir conteúdo textual real (só letras, sem números/espaços/traços)
            const alphaContent = pd.text.replace(/[^a-záéíóúàâêôãõçA-ZÁÉÍÓÚÀÂÊÔÃÕÇ]/g, '');
            
            // Folha de respostas = muitos números baixos + pouco texto real
            // (Uma folha de respostas típica tem 30+ números e quase nenhum texto)
            if (restartNums.length >= 10 && alphaContent.length < 500 && runningMax > 20) {
                cutoffPage = pd.pageNumber;
                console.log(`📋 Folha de respostas detectada: pág ${cutoffPage} (${restartNums.length} números reiniciados, ${alphaContent.length} chars texto)`);
                break;
            }
        }
        
        if (cutoffPage !== Infinity) {
            console.log(`📋 Removendo folha de respostas a partir da página ${cutoffPage}`);
            result.pages = result.pages.filter(p => p.pageNumber < cutoffPage);
        }
        
        // Recalcular summary
        result.allImages = result.pages.flatMap(p => p.images || []);
        result.summary.totalPages = result.pages.length;
        result.summary.totalImages = result.allImages.length;
        result.summary.totalCharacters = result.pages.reduce((s, p) => s + p.characterCount, 0);
        result.summary.pagesWithImages = result.pages.filter(p => (p.images || []).length > 0).length;
        result.fullText = result.pages.map(p => p.text).join('\n\n');
        
        console.log(`✅ Extração: ${result.summary.totalPages} páginas (skip pág 1), ${result.summary.totalImages} imagens`);
        
        // 2. Adicionar campo "questao" em cada imagem
        tagImagensComQuestao(result.pages);
        console.log(`🏷️ Imagens tagueadas com número da questão`);
        
        // 3. Processar gabarito
        let gabarito_data = {};
        let gabaritoSource = 'nenhum';
        
        if (gabaritoFile) {
            console.log(`📋 Extraindo gabarito de: ${gabaritoFile.originalname}`);
            const gabaritoText = await pdfExtractor.extractText(gabaritoFile.path);
            const textoCompleto = gabaritoText.pages.map(p => p.text).join('\n');
            
            // Pegar apenas o TIPO 1 (tudo entre "TIPO 1" e "TIPO 2")
            const tipoMatch = textoCompleto.match(/TIPO\s*1\s*\n([\s\S]*?)(?=Professor.*TIPO\s*2|$)/i);
            const blocoTipo1 = tipoMatch ? tipoMatch[1] : textoCompleto;
            
            // Parse: linhas de números seguidas por linhas de letras
            const linhas = blocoTipo1.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            console.log(`📋 Bloco TIPO 1: ${linhas.length} linhas`);
            
            for (let i = 0; i < linhas.length - 1; i++) {
                // Linha de números: só dígitos e espaços
                if (!/^\d[\d\s]+\d$/.test(linhas[i])) continue;
                const numeros = linhas[i].match(/\d+/g);
                // Próxima linha: letras A-E e * separadas por espaço
                const letras = linhas[i + 1].match(/[A-E*]/gi);
                
                if (numeros && letras && numeros.length >= 3 && numeros.length === letras.length) {
                    for (let j = 0; j < numeros.length; j++) {
                        const resp = letras[j].toUpperCase();
                        gabarito_data[numeros[j]] = resp === '*' ? 'ANULADA' : resp;
                    }
                    i++; // pular a linha de letras já processada
                }
            }
            
            gabaritoSource = gabaritoFile.originalname;
            console.log(`✅ Gabarito TIPO 1 parseado: ${Object.keys(gabarito_data).length} respostas`);
            
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
        
        // 4. Resposta - data do extractAll (imagens com campo questao) + gabarito
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
