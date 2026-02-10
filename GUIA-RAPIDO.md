# 🎯 Guia Rápido - Nova Estrutura da API

## O que mudou?

Antes a API retornava os dados separados:
- `data.text.pages[]` - Texto das páginas
- `data.images[]` - Todas as imagens do PDF

Agora a API retorna **tudo agrupado por página**:
- `data.pages[]` - Cada página já contém seu texto E suas imagens

## Exemplo Prático

### ✅ NOVO FORMATO (Atual)

```json
{
  "success": true,
  "data": {
    "pages": [
      {
        "pageNumber": 1,
        "text": "QUESTÃO 01...",
        "images": [
          {
            "id": "img_1_1",
            "base64": "iVBORw0KGgo...",
            "width": 400,
            "height": 300
          }
        ],
        "imageCount": 1
      }
    ],
    "fullText": "Texto completo...",
    "allImages": [ /* todas as imagens */ ],
    "summary": {
      "totalPages": 1,
      "totalImages": 1,
      "pagesWithImages": 1
    }
  }
}
```

## Como usar no n8n?

### Passo 1: Chamar a API

```javascript
POST http://localhost:3000/extract/base64

Body:
{
  "pdfBase64": "JVBERi0x...",
  "filename": "prova.pdf"
}
```

### Passo 2: Processar cada página (Function node)

```javascript
const pages = items[0].json.data.pages;

// Retornar um item por página
return pages.map(page => ({
  json: {
    numero: page.pageNumber,
    texto: page.text,
    imagens: page.images  // ← Imagens já estão aqui!
  }
}));
```

### Passo 3: Inserir no banco

Agora você pode fazer em **UMA query**:

```sql
-- Inserir questão
INSERT INTO questoes (numero, texto, tem_imagem)
VALUES ($json.numero, $json.texto, $json.imagens.length > 0);

-- Depois separar as imagens (se tiver)
-- Use Split Out no array $json.imagens
```

## Vantagens

✅ **Menos complexidade**: Não precisa filtrar imagens por página  
✅ **Performance**: Menos loops no n8n  
✅ **Clareza**: Fica óbvio qual imagem pertence a qual questão  
✅ **Facilidade**: Um loop resolve tudo!  

## Exemplo Completo - n8n

```
PDF → API → Processar Páginas → Para cada página:
                                    ├─ Inserir questão
                                    └─ Se tem imagem:
                                        └─ Separar imagens
                                           └─ Inserir cada imagem
```

Veja o arquivo completo: `examples/n8n-workflow-complete.json`

## Campos Disponíveis

### Por Página (`data.pages[].`)
- `pageNumber` - Número da página
- `text` - Texto da página/questão
- `characterCount` - Total de caracteres
- `images` - Array de imagens desta página
- `imageCount` - Quantidade de imagens

### Por Imagem (`data.pages[].images[].`)
- `id` - Identificador único
- `page` - Número da página
- `base64` - String base64 puro (sem prefixo)
- `dataUrl` - String pronta para usar em `<img src="">`
- `width` - Largura em pixels
- `height` - Altura em pixels
- `format` - Formato (png, jpeg)
- `mimeType` - MIME type (image/png)
- `sizeBytes` - Tamanho em bytes

### Resumo Global (`data.summary.`)
- `totalPages` - Total de páginas
- `totalImages` - Total de imagens
- `totalCharacters` - Total de caracteres
- `pagesWithImages` - Páginas que contêm imagens

## Compatibilidade

A interface web foi atualizada e funciona com o novo formato automaticamente! 🎉

Acesse: http://localhost:3000
