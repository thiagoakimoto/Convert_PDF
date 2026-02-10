# 📄 API de Extração de PDF para Concursos

API em Node.js para extrair texto e imagens de PDFs de provas de concursos públicos e **processar gabaritos automaticamente**. Retorna questões com imagens no formato **base64** e respostas corretas já vinculadas, facilitando a integração com **n8n** e bancos de dados.

## 🌟 Funcionalidades

- ✅ Extração de texto completo com estrutura de páginas
- ✅ Extração de imagens em formato PNG base64
- ✅ **Extração de gabarito via OCR (Tesseract.js)** com suporte a português
- ✅ **Match automático de questões com gabarito** - retorna respostaCorreta em cada questão
- ✅ **Detecção automática de números de questões** do texto
- ✅ Suporte a gabarito manual (JSON) ou imagem (OCR)
- ✅ **Endpoint unificado**: envie PDF + gabarito → receba questões com respostas
- ✅ Interface web para testes locais
- ✅ Visualização de imagens inline com o texto das questões (por página)
- ✅ Cópia rápida de base64 das imagens
- ✅ Múltiplos endpoints para diferentes necessidades
- ✅ Integração fácil com n8n
- ✅ Estatísticas de match (percentual de questões encontradas)

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

### Workflow Completo com Gabarito (Recomendado)

Para processar prova + gabarito automaticamente em um único fluxo:

```
[Google Drive: List Files]
    ↓
[Filter: Provas PDFs]
    ↓
[Google Drive: Download PDF] (nome do arquivo: "prova")
    ↓
[Google Drive: Download Gabarito Image] (nome do arquivo: "gabarito") 
    ↓
[HTTP Request: POST /processar-prova-completa]
    - Method: POST
    - URL: http://seu-servidor/processar-prova-completa
    - Send Body: Yes
    - Body Content Type: Form-Data/Multipart
    - Body Parameters:
      * prova: (Binary Data) {{ $binary.prova }}
      * gabarito: (Binary Data) {{ $binary.gabarito }}
    ↓
[Function: Processar Resposta]
    ↓
[Split Out: Dividir questões]
    ↓
[PostgreSQL: Inserir questão com resposta correta]
```

**Function para processar resposta:**
```javascript
// Extrai as questões com respostas corretas já vinculadas
const questoes = $json.data.questoes;

return questoes.map(q => ({
  json: {
    numero: q.numeroQuestao,
    texto: q.text,
    resposta_correta: q.respostaCorreta,
    tem_resposta: q.temResposta,
    tem_imagens: q.imageCount > 0,
    imagens: q.images
  }
}));
```

**Insert SQL:**
```sql
INSERT INTO questoes (numero, texto, resposta_correta, tem_imagens)
VALUES (
  $json.numero,
  $json.texto,
  $json.resposta_correta,
  $json.tem_imagens
);
```

**Estatísticas do Match:**
```javascript
// Acesse as estatísticas de matching
const stats = $json.data.stats;
console.log(`Match: ${stats.percentualMatch}%`);
console.log(`Questões com resposta: ${stats.questoesComResposta}`);
console.log(`Questões sem resposta: ${stats.questoesSemResposta}`);
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
│       ├── pdfExtractor.js       # Lógica de extração de PDF
│       └── gabaritoExtractor.js  # Lógica de extração de gabarito (OCR)
└── uploads/                      # Arquivos temporários (criado automaticamente)
```

---

## 📋 Endpoints de Gabarito

### 6. Extrair Gabarito de Arquivo (OCR)
```http
POST /gabarito/extrair
Content-Type: multipart/form-data
```

**Body:**
- `gabarito`: Arquivo PDF ou imagem (PDF, PNG, JPG, JPEG) contendo a tabela de gabarito

**Nota:** O sistema detecta automaticamente o formato:
- **PDF**: Extrai texto diretamente (mais rápido e preciso)
- **Imagem**: Usa OCR com Tesseract.js (melhor com imagens nítidas de 300 DPI)

**Resposta:****
```json
{
  "success": true,
  "data": {
    "1": "A",
    "2": "C",
    "3": "B",
    "4": "E",
    "5": "D"
  },
  "metadata": {
    "totalQuestoes": 5,
    "metodo": "ocr"
  }
}
```

---

### 7. Processar Gabarito Manual (JSON)
```http
POST /gabarito/manual
Content-Type: application/json
```

**Body:**
```json
{
  "gabarito": {
    "1": "A",
    "2": "C",
    "3": "B"
  }
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "1": "A",
    "2": "C",
    "3": "B"
  },
  "metadata": {
    "totalQuestoes": 3,
    "metodo": "manual"
  }
}
```

---

### 8. Processar Prova Completa (PDF + Gabarito)
```http
POST /processar-prova-completa
Content-Type: multipart/form-data
```

**Body:**
- `prova`: Arquivo PDF da prova
- `gabarito` (opcional): Arquivo PDF ou imagem do gabarito OU JSON no corpo da requisição

**Exemplos:**

**Opção 1: PDF + PDF do Gabarito**
```
Form-Data:
  prova: [arquivo PDF]
  gabarito: [arquivo PDF do gabarito]
```

**Opção 2: PDF + Imagem do Gabarito**
```
Form-Data:
  prova: [arquivo PDF]
  gabarito: [arquivo de imagem PNG/JPG]
```

**Opção 3: PDF + JSON Gabarito****
```
Form-Data:
  prova: [arquivo PDF]
  
Body JSON adicional:
{
  "gabarito": {
    "1": "A",
    "2": "C",
    "3": "B"
  }
}
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "questoes": [
      {
        "pageNumber": 1,
        "text": "QUESTÃO 01\nQual é a capital do Brasil?\nA) São Paulo\nB) Rio de Janeiro\nC) Brasília\nD) Salvador\nE) Belo Horizonte",
        "images": [
          {
            "pageNumber": 1,
            "imageIndex": 0,
            "width": 800,
            "height": 600,
            "base64": "data:image/png;base64,iVBOR..."
          }
        ],
        "imageCount": 1,
        "numeroQuestao": 1,
        "respostaCorreta": "C",
        "temResposta": true
      }
    ],
    "stats": {
      "totalQuestoes": 50,
      "questoesComResposta": 50,
      "questoesSemResposta": 0,
      "percentualMatch": 100
    },
    "gabarito": {
      "1": "C",
      "2": "A",
      "3": "B"
    },
    "metadata": {
      "totalPages": 20,
      "pdfMetadata": {
        "title": "Prova ENEM 2024",
        "author": "INEP"
      }
    }
  }
}
```

**Campos Especiais:**
- `numeroQuestao`: Número da questão detectado automaticamente do texto
- `respostaCorreta`: Resposta do gabarito para essa questão
- `temResposta`: Indica se a questão foi encontrada no gabarito
- `stats.percentualMatch`: Percentual de questões que foram encontradas no gabarito

---

## ⚙️ Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do servidor | `3000` |

---

## 📝 Notas Importantes

1. **Limite de Tamanho**: O limite padrão é 100MB por arquivo PDF e 50MB para gabaritos
2. **Formatos de Imagem**: As imagens são extraídas no formato PNG
3. **Arquivos Temporários**: Arquivos enviados são deletados após processamento
4. **Base64**: O campo `dataUrl` já vem formatado para uso direto em `<img src="...">`
5. **Gabarito em PDF ou Imagem**: O sistema aceita **PDF** ou **imagem** (PNG/JPG):
   - **PDF**: Extrai texto diretamente (recomendado, mais rápido e preciso)
   - **Imagem**: Processa via OCR com Tesseract.js (use imagens nítidas de 300 DPI)
6. **OCR de Gabarito**: Tesseract.js com português (por). Detecção automática de formato.
7. **Match Automático**: Detecta números de questões usando padrões: "QUESTÃO 01", "01)", "Q.01"
8. **Formatos de Gabarito Suportados**: 
   - PDF (primeira página é convertida para imagem)
   - Imagem PNG/JPG com tabela de texto: "1 - A", "1: B", "1. C"
   - Lista simples: "1 A", "01 B"
   - JSON manual: `{"1": "A", "2": "B"}`

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

### OCR não reconhece gabarito corretamente
1. Certifique-se de que a imagem está legível e com boa resolução (mínimo 300 DPI)
2. Evite imagens com muito ruído ou baixo contraste
3. Prefira formatos PNG sobre JPG para melhor qualidade
4. Se o OCR falhar, use o endpoint `/gabarito/manual` com JSON
5. Verifique se a imagem contém apenas a tabela de gabarito (sem cabeçalhos complexos)

### Questões não fazem match com gabarito
1. Verifique se o texto das questões contém o número (ex: "QUESTÃO 01")
2. Use o campo `stats.questoesSemResposta` para identificar questões não encontradas
3. Confirme que a numeração do gabarito corresponde à numeração das questões
4. Para casos especiais, processe o gabarito separadamente e faça match manual

---

## 📞 Suporte

Desenvolvido para automatização de cadastro de questões de concursos públicos.
