const extractor = require('./src/extractors/pdfExtractor');
const path = require('path');

async function testCoords() {
    const pdfPath = path.join(__dirname, 'enem2025.pdf');
    
    console.log('Testando extração de coordenadas Y...\n');
    
    const result = await extractor.extractForExam(pdfPath, { skipFirstPage: true, maxImageWidth: 800 });
    
    // Verificar página 8
    const page8 = result.pages.find(p => p.pageNumber === 8);
    
    if (page8) {
        console.log('=== PÁGINA 8 ===');
        console.log('questionRanges:', JSON.stringify(page8.questionRanges, null, 2));
        console.log('\nImagens:', page8.images.length);
        page8.images.forEach((img, i) => {
            console.log(`\nImagem ${i}:`);
            console.log(`  id: ${img.id}`);
            console.log(`  yPos: ${img.yPos}`);
            console.log(`  width: ${img.width}`);
            console.log(`  height: ${img.height}`);
        });
    } else {
        console.log('Página 8 não encontrada!');
    }
    
    // Verificar primeira página com imagem
    const pageWithImage = result.pages.find(p => p.images && p.images.length > 0);
    if (pageWithImage && pageWithImage.pageNumber !== 8) {
        console.log(`\n=== PÁGINA ${pageWithImage.pageNumber} (primeira com imagem) ===`);
        console.log('questionRanges:', JSON.stringify(pageWithImage.questionRanges, null, 2));
        console.log('\nImagens:', pageWithImage.images.length);
        pageWithImage.images.forEach((img, i) => {
            console.log(`\nImagem ${i}:`);
            console.log(`  id: ${img.id}`);
            console.log(`  yPos: ${img.yPos}`);
        });
    }
}

testCoords().catch(console.error);
