# 📄 API de Extração de PDF para Concursos

API em Node.js para extrair texto e imagens de PDFs de provas de concursos públicos. Retorna as imagens no formato **base64** para fácil integração com o **n8n** e bancos de dados.

## 🌟 Funcionalidades

- ✅ Extração de texto completo com estrutura de páginas
- ✅ Extração de imagens em formato PNG base64
- ✅ Interface web para testes locais
- ✅ **Visualização de imagens inline com o texto das questões** (por página)
- ✅ Cópia rápida de base64 das imagens
- ✅ Múltiplos endpoints para diferentes necessidades
- ✅ Integração fácil com n8n

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Iniciar em modo desenvolvimento (com hot reload)
npm run dev

# Iniciar em modo produção
npm start
```

A API estará disponível em: `http://localhost:3000`

## 📋 Endpoints Disponíveis

### 1. Health Check
```http
GET /health
```
Verifica se a API está funcionando.

**Resposta:**
```json
{
  "status": "ok",
  "message": "API de Extração de PDF funcionando!",
  "timestamp": "2026-02-10T10:00:00.000Z"
}
```

---

### 2. Extrair Tudo (Texto + Imagens)
```http
POST /extract
Content-Type: multipart/form-data
```

**Parâmetros:**
- `pdf` (file): Arquivo PDF a ser processado

**Resposta:**
```json
{
  "success": true,
  "filename": "prova_2024.pdf",
  "data": {
    "metadata": {
      "title": "Prova de Conhecimentos",
      "author": "Banca Organizadora",
      "pageCount": 20
    },
    "pages": [
      {
        "pageNumber": 1,
        "text": "QUESTÃO 01 - Sobre a Constituição Federal...\n\nA) Alternativa A\nB) Alternativa B\nC) Alternativa C\nD) Alternativa D",
        "characterCount": 1500,
        "images": [
          {
            "id": "img_1_1",
            "page": 1,
            "width": 400,
            "height": 300,
            "format": "png",
            "mimeType": "image/png",
            "base64": "iVBORw0KGgo...",
            "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
            "sizeBytes": 45678
          }
        ],
        "imageCount": 1
      },
      {
        "pageNumber": 2,
        "text": "QUESTÃO 02 - Sobre direito administrativo...",
        "characterCount": 800,
        "images": [],
        "imageCount": 0
      }
    ],
    "fullText": "Todo o texto do PDF concatenado...",
    "allImages": [
      {
        "id": "img_1_1",
        "page": 1,
        "width": 400,
        "height": 300,
        "format": "png",
        "mimeType": "image/png",
        "base64": "iVBORw0KGgo...",
        "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
        "sizeBytes": 45678
      }
    ],
    "summary": {
      "totalPages": 20,
      "totalImages": 15,
      "totalCharacters": 50000,
      "pagesWithImages": 8
    }
  }
}
```

**Observação Importante:** Cada página no array `pages` já contém suas próprias imagens no campo `images`, facilitando a integração com bancos de dados e fluxos do n8n. Você pode iterar sobre `pages` e inserir cada questão com suas respectivas imagens de uma só vez!

---

### 3. Extrair Apenas Imagens
```http
POST /extract/images
Content-Type: multipart/form-data
```

**Parâmetros:**
- `pdf` (file): Arquivo PDF

**Resposta:**
```json
{
  "success": true,
  "filename": "prova.pdf",
  "totalImages": 15,
  "images": [
    {
      "id": "img_1_1",
      "page": 1,
      "width": 400,
      "height": 300,
      "format": "png",
      "mimeType": "image/png",
      "base64": "iVBORw0KGgo...",
      "dataUrl": "data:image/png;base64,iVBORw0KGgo...",
      "sizeBytes": 45678
    }
  ]
}
```

---

### 4. Extrair Apenas Texto
```http
POST /extract/text
Content-Type: multipart/form-data
```

**Parâmetros:**
- `pdf` (file): Arquivo PDF

**Resposta:**
```json
{
  "success": true,
  "filename": "prova.pdf",
  "data": {
    "pages": [
      {
        "pageNumber": 1,
        "text": "QUESTÃO 01 - Sobre a Constituição Federal...",
        "characterCount": 1500
      }
    ],
    "fullText": "Todo o texto...",
    "totalPages": 20
  }
}
```

---

### 5. Processar PDF via Base64 (Ideal para n8n)
```http
POST /extract/base64
Content-Type: application/json
```

**Body:**
```json
{
  "pdfBase64": "JVBERi0xLjQKJ...",
  "filename": "prova.pdf"
}
```

**Resposta:** Igual ao endpoint `/extract`

---

## 🔧 Integração com n8n

### Opção 1: Usando HTTP Request com Upload de Arquivo

1. Use o nó **Read Binary File** ou **HTTP Request** para obter o PDF
2. Adicione um nó **HTTP Request**:
   - Método: `POST`
   - URL: `http://localhost:3000/extract`
   - Body Content Type: `Form-Data/Multipart`
   - Form Data:
     - Nome: `pdf`
     - Tipo: `File`
     - Input Data Field Name: `data` (ou o nome do campo binário)

### Opção 2: Usando Base64 (Recomendado)

1. Use o nó **Read Binary File** para obter o PDF
2. Use o nó **Function** para converter para base64:
```javascript
const binaryData = $binary.data;
const base64 = binaryData.data;

return [{
  json: {
    pdfBase64: base64,
    filename: binaryData.fileName
  }
}];
```
3. Adicione um nó **HTTP Request**:
   - Método: `POST`
   - URL: `http://localhost:3000/extract/base64`
   - Body Content Type: `JSON`
   - JSON: `{{ $json }}`

### Exemplo de Workflow n8n

```
[Trigger] → [Read Binary File] → [HTTP Request (API)] → [Split/Process] → [Database Insert]
```

### Processando Questões com Imagens no n8n

Com o novo formato da API, você pode processar facilmente cada página com suas imagens:

```javascript
// No nó Function do n8n, após receber a resposta da API:
const pages = $json.data.pages;

// Criar um item para cada página/questão
const items = pages.map(page => ({
  json: {
    questao_numero: page.pageNumber,
    questao_texto: page.text,
    questao_caracteres: page.characterCount,
    tem_imagem: page.imageCount > 0,
    imagens: page.images.map(img => ({
      id: img.id,
      base64: img.base64,
      largura: img.width,
      altura: img.height,
      formato: img.format,
      tamanho_bytes: img.sizeBytes
    }))
  }
}));

return items;
```

Depois você pode usar **Split Out** para dividir em itens individuais e inserir no banco de dados.

#### Inserindo no PostgreSQL/MySQL

```sql
-- Tabela de questões
INSERT INTO questoes (numero, texto, caracteres)
VALUES ($json.questao_numero, $json.questao_texto, $json.questao_caracteres);

-- Tabela de imagens (para cada imagem da questão)
INSERT INTO questoes_imagens (questao_id, imagem_base64, largura, altura)
VALUES (LAST_INSERT_ID(), $json.imagens[0].base64, $json.imagens[0].largura, $json.imagens[0].altura);
```

---

## 📁 Estrutura do Projeto

```
Convert_PDF/
├── package.json
├── README.md
├── src/
│   ├── server.js              # Servidor Express
│   └── extractors/
│       └── pdfExtractor.js    # Lógica de extração
└── uploads/                   # Arquivos temporários (criado automaticamente)
```

---

## ⚙️ Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |

---

## 📝 Notas Importantes

1. **Limite de Tamanho**: O limite padrão é 100MB por arquivo PDF
2. **Formatos de Imagem**: As imagens são extraídas no formato PNG
3. **Arquivos Temporários**: Arquivos enviados são deletados após processamento
4. **Base64**: O campo `dataUrl` já vem formatado para uso direto em `<img src="...">`

---

## 🐛 Solução de Problemas

### Erro: "Canvas not found"
Algumas funcionalidades avançadas requerem o pacote `canvas`:
```bash
npm install canvas
```

### Erro ao instalar sharp no Windows
```bash
npm install --platform=win32 sharp
```

### Imagens não extraídas
Algumas imagens em PDFs podem estar em formatos especiais. A API tenta múltiplos métodos de extração.

---

## 📞 Suporte

Desenvolvido para automatização de cadastro de questões de concursos públicos.
