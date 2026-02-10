/**
 * Script de teste para a API de Extração de PDF
 * Execute: node test/testApi.js
 */

const fs = require('fs');
const path = require('path');

const API_URL = 'http://localhost:3000';

async function testHealthCheck() {
    console.log('\n📋 Testando Health Check...');
    
    try {
        const response = await fetch(`${API_URL}/health`);
        const data = await response.json();
        
        if (data.status === 'ok') {
            console.log('✅ Health Check OK:', data.message);
            return true;
        } else {
            console.log('❌ Health Check falhou');
            return false;
        }
    } catch (error) {
        console.log('❌ Erro no Health Check:', error.message);
        console.log('   Certifique-se de que a API está rodando em', API_URL);
        return false;
    }
}

async function testExtractWithFile(pdfPath) {
    console.log('\n📄 Testando extração de PDF...');
    
    if (!fs.existsSync(pdfPath)) {
        console.log('⚠️  Arquivo de teste não encontrado:', pdfPath);
        console.log('   Crie um arquivo PDF de teste ou altere o caminho');
        return;
    }
    
    try {
        const formData = new FormData();
        const pdfBuffer = fs.readFileSync(pdfPath);
        const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
        formData.append('pdf', blob, path.basename(pdfPath));
        
        const response = await fetch(`${API_URL}/extract`, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Extração bem-sucedida!');
            console.log('   Páginas:', data.data.summary.totalPages);
            console.log('   Imagens encontradas:', data.data.summary.totalImages);
            console.log('   Caracteres:', data.data.summary.totalCharacters);
            
            if (data.data.images.length > 0) {
                console.log('\n   Primeira imagem:');
                console.log('   - ID:', data.data.images[0].id);
                console.log('   - Página:', data.data.images[0].page);
                console.log('   - Dimensões:', `${data.data.images[0].width}x${data.data.images[0].height}`);
                console.log('   - Tamanho:', data.data.images[0].sizeBytes, 'bytes');
                console.log('   - Base64 (primeiros 50 chars):', data.data.images[0].base64.substring(0, 50) + '...');
            }
        } else {
            console.log('❌ Erro na extração:', data.error);
        }
    } catch (error) {
        console.log('❌ Erro ao testar extração:', error.message);
    }
}

async function testExtractBase64(pdfPath) {
    console.log('\n📄 Testando extração via Base64...');
    
    if (!fs.existsSync(pdfPath)) {
        console.log('⚠️  Arquivo de teste não encontrado:', pdfPath);
        return;
    }
    
    try {
        const pdfBuffer = fs.readFileSync(pdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');
        
        const response = await fetch(`${API_URL}/extract/base64`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                pdfBase64: pdfBase64,
                filename: path.basename(pdfPath)
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('✅ Extração via Base64 bem-sucedida!');
            console.log('   Páginas:', data.data.summary.totalPages);
            console.log('   Imagens:', data.data.summary.totalImages);
        } else {
            console.log('❌ Erro:', data.error);
        }
    } catch (error) {
        console.log('❌ Erro:', error.message);
    }
}

// Executar testes
async function runTests() {
    console.log('🧪 Iniciando testes da API de Extração de PDF');
    console.log('=' .repeat(50));
    
    const healthOk = await testHealthCheck();
    
    if (!healthOk) {
        console.log('\n❌ API não está disponível. Abortando testes.');
        console.log('   Execute: npm start');
        return;
    }
    
    // Se você tiver um PDF de teste, coloque o caminho aqui
    const testPdfPath = process.argv[2] || './test/sample.pdf';
    
    if (fs.existsSync(testPdfPath)) {
        await testExtractWithFile(testPdfPath);
        await testExtractBase64(testPdfPath);
    } else {
        console.log('\n⚠️  Para testar a extração, execute:');
        console.log('   node test/testApi.js caminho/para/seu.pdf');
    }
    
    console.log('\n' + '=' .repeat(50));
    console.log('🏁 Testes finalizados!');
}

runTests();
