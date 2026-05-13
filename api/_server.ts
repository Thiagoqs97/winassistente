import 'dotenv/config';
import express from 'express';
import path from 'path';
import { Pool } from 'pg';
import multer from 'multer';
import * as xlsx from 'xlsx';
import OpenAI from 'openai';
import axios from 'axios';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 5,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const upload = multer({ storage: multer.memoryStorage() });

// --- Lazy Database Initialization ---
let dbInitPromise: Promise<void> | null = null;

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(255) UNIQUE,
        descricao TEXT NOT NULL,
        preco_venda NUMERIC(10, 2),
        marca VARCHAR(255),
        embalagem VARCHAR(255),
        categoria VARCHAR(255),
        codigo_barras VARCHAR(255),
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS categoria VARCHAR(255);`);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(255);`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao
      ON products USING GIN (descricao gin_trgm_ops);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        id VARCHAR(50) PRIMARY KEY,
        core_prompt TEXT NOT NULL,
        session_timeout_hours INTEGER DEFAULT 2
      );
    `);
    await client.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS session_timeout_hours INTEGER DEFAULT 2;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendedores (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        numero_whatsapp TEXT UNIQUE NOT NULL,
        nome TEXT,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessoes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE CASCADE,
        iniciada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        encerrada_em TIMESTAMP,
        status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada', 'orcamento_gerado'))
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sessao_id UUID REFERENCES sessoes(id) ON DELETE CASCADE,
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE CASCADE,
        papel TEXT NOT NULL CHECK (papel IN ('user', 'assistant')),
        conteudo TEXT NOT NULL,
        tipo_midia TEXT DEFAULT 'texto' CHECK (tipo_midia IN ('texto', 'audio', 'imagem', 'pdf', 'planilha')),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS ultimos_produtos JSONB;`);
    await client.query(`ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE mensagens DISABLE ROW LEVEL SECURITY;`);

    const defaultPrompt = `1. O agente tem acesso ao histórico completo da sessão ativa e deve utilizá-lo para entender pedidos construídos em múltiplas mensagens.
2. O agente confirma os itens identificados antes de gerar qualquer orçamento, perguntando ao vendedor se os produtos encontrados correspondem ao que foi solicitado.
3. O agente gera e envia o orçamento completo após a confirmação dos itens, calculando o total, sem necessidade de intervenção humana.
4. O agente não mistura contextos de sessões diferentes — quando detecta o início de um novo pedido, trata-o de forma totalmente isolada.
5. O agente nunca inventa produtos — trabalha exclusivamente com os itens retornados pela busca no estoque.
6. NUNCA use tabelas com | para formatar o orçamento — use o formato de lista com emojis e negrito (*texto*) nativo do WhatsApp.`;

    await client.query(`
      INSERT INTO system_config (id, core_prompt, session_timeout_hours)
      VALUES ('default', $1, 2)
      ON CONFLICT (id) DO NOTHING;
    `, [defaultPrompt]);

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    throw err;
  } finally {
    client.release();
  }
}

function ensureDB() {
  if (!dbInitPromise) {
    dbInitPromise = initDB();
  }
  return dbInitPromise;
}

// Middleware: ensure DB is ready before any request (skip for webhook — it inits DB internally after responding)
app.use(async (req, _res, next) => {
  if (req.path === '/api/webhook/evolution') return next();
  try {
    await ensureDB();
    next();
  } catch (err) {
    next(err);
  }
});

// --- API ROUTES ---

// 1. Upload Stock (XLSX) — recebe base64 via JSON para compatibilidade com Vercel serverless
app.post('/api/upload-stock', async (req, res) => {
  try {
    const { fileData } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const buffer = Buffer.from(fileData, 'base64');
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[];

    if (rawData.length === 0) {
      return res.status(400).json({ error: 'Planilha vazia ou formato não reconhecido' });
    }

    console.log('Colunas encontradas:', Object.keys(rawData[0]));

    // Fix 2: busca dinâmica com trim + lowercase + match parcial
    const getVal = (row: Record<string, any>, exactKeys: string[], partialKeys: string[]) => {
      const keys = Object.keys(row).map(k => ({ original: k, lower: k.trim().toLowerCase() }));
      const exact = keys.find(({ lower }) => exactKeys.some(ek => lower === ek.toLowerCase()));
      if (exact) return row[exact.original];
      const partial = keys.find(({ lower }) => partialKeys.some(pk => lower.includes(pk.toLowerCase())));
      return partial ? row[partial.original] : null;
    };

    // Fix 1: parse de preço brasileiro (R$ 1.234,50 → 1234.50)
    const parsePreco = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number') return isFinite(val) ? val : null;
      // Remove "R$", espaços, pontos de milhar; troca vírgula decimal por ponto
      const cleaned = String(val)
        .replace(/R\$\s*/gi, '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^0-9.-]/g, '');
      const n = parseFloat(cleaned);
      return isFinite(n) && n > 0 ? n : null;
    };

    // Fix 3: resolve marca que vem como ID numérico — busca coluna vizinha textual
    const getMarca = (row: Record<string, any>): string | null => {
      const keys = Object.keys(row);
      const marcaKeys = keys.filter(k => k.trim().toLowerCase().includes('marca'));
      for (const k of marcaKeys) {
        const v = row[k];
        if (v && isNaN(Number(v))) return String(v).trim();
      }
      // fallback: retorna qualquer valor de marca mesmo que numérico
      if (marcaKeys.length > 0) {
        const v = row[marcaKeys[0]];
        return v ? String(v).trim() : null;
      }
      return null;
    };

    let inserted = 0;
    let skipped = 0;

    // Monta todos os registros válidos antes de gravar
    const rows: any[][] = [];
    let autoIdx = 1;
    for (const row of rawData) {
      const descricao = getVal(row,
        ['descrição', 'descricao', 'desc', 'nome', 'produto'],
        ['descri', 'nome do produto']
      );
      if (!descricao || String(descricao).trim() === '') { skipped++; continue; }

      const codigo = getVal(row,
        ['código', 'codigo', 'cod', 'sku', 'código interno', 'codigo interno'],
        ['códig', 'codig', 'sku']
      );
      const precoRaw = getVal(row,
        [
          'tipo integração b2b venda', 'tipo integracao b2b venda',
          'sugerir preço de venda baseado', 'sugerir preco de venda baseado',
          'preço de venda', 'preco de venda', 'preço venda', 'preco venda',
          'venda', 'preço', 'preco', 'valor', 'price',
        ],
        ['tipo integraç', 'tipo integrac', 'sugerir preç', 'sugerir prec', 'preço', 'preco', 'valor', 'venda']
      );
      const embalagem = getVal(row, ['embalagem', 'emb'], ['embalagem']);
      const categoria = getVal(row,
        ['nome da categoria', 'categoria', 'nome categoria'],
        ['categ']
      );
      const codigoBarras = getVal(row,
        [
          'gtin unid.venda', 'gtin unid. venda', 'gtin',
          'unidade venda [ean8, upc12, ean13, e dun14]',
          'ean unid. tributável', 'ean unid.tributável',
          'codigo de barras', 'código de barras', 'ean',
        ],
        ['gtin', 'ean', 'barras', 'codigo_barras']
      );

      rows.push([
        codigo ? String(codigo).trim() : `auto_${autoIdx++}`,
        String(descricao).trim(),
        parsePreco(precoRaw),
        getMarca(row),
        embalagem ? String(embalagem).trim() : null,
        categoria ? String(categoria).trim() : null,
        codigoBarras ? String(codigoBarras).trim() : null,
      ]);
    }

    // Fix 4: chunking — grava em lotes de 500 para não estourar memória/timeout
    const CHUNK = 500;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM products');

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        // Monta INSERT multi-row por chunk
        const values: any[] = [];
        const placeholders = chunk.map((_, ci) => {
          const base = i + ci;
          const p = (n: number) => `$${base * 7 + n + 1}`;
          values.push(...chunk[ci]);
          return `(${[0,1,2,3,4,5,6].map(n => p(n)).join(',')})`;
        });
        // Recalcula placeholders sem acumular offset errado
        const placeholders2 = chunk.map((row, ci) => {
          const b = ci * 7;
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
        });
        const vals2: any[] = chunk.flat();
        await client.query(`
          INSERT INTO products (codigo, descricao, preco_venda, marca, embalagem, categoria, codigo_barras)
          VALUES ${placeholders2.join(',')}
          ON CONFLICT (codigo) DO UPDATE
          SET descricao=EXCLUDED.descricao, preco_venda=EXCLUDED.preco_venda,
              marca=EXCLUDED.marca, embalagem=EXCLUDED.embalagem,
              categoria=EXCLUDED.categoria, codigo_barras=EXCLUDED.codigo_barras,
              ativo=true
        `, vals2);
        inserted += chunk.length;
      }

      await client.query('COMMIT');
      res.json({ message: `${inserted} produtos importados com sucesso.${skipped > 0 ? ` (${skipped} linhas ignoradas)` : ''}` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message || 'Erro ao processar planilha' });
  }
});

// 2. Fetch Products
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC LIMIT 500');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 3. Toggle Product Active Status
app.put('/api/products/:id/toggle', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      'UPDATE products SET ativo = NOT ativo WHERE id = $1 RETURNING *',
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 4. Config Get/Set
app.get('/api/config', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.put('/api/config', async (req, res) => {
  const { core_prompt, session_timeout_hours } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE system_config SET core_prompt = $1, session_timeout_hours = $2 WHERE id = 'default' RETURNING *`,
      [core_prompt, session_timeout_hours]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 5. History: List Vendedores
app.get('/api/vendedores', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.id, v.numero_whatsapp, v.nome, v.ativo, v.criado_em,
             COUNT(s.id)::int AS total_sessoes,
             MAX(s.iniciada_em) AS ultima_sessao
      FROM vendedores v
      LEFT JOIN sessoes s ON s.vendedor_id = v.id
      GROUP BY v.id
      ORDER BY ultima_sessao DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 6. History: Update Vendedor name
app.put('/api/vendedores/:id', async (req, res) => {
  const { nome, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE vendedores SET nome = COALESCE($1, nome), ativo = COALESCE($2, ativo) WHERE id = $3 RETURNING *',
      [nome, ativo, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 7. History: Sessions for a Vendedor
app.get('/api/vendedores/:vendedorId/sessoes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.iniciada_em, s.encerrada_em, s.status,
             COUNT(m.id)::int AS total_mensagens
      FROM sessoes s
      LEFT JOIN mensagens m ON m.sessao_id = s.id
      WHERE s.vendedor_id = $1
      GROUP BY s.id
      ORDER BY s.iniciada_em DESC
    `, [req.params.vendedorId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 8. History: Messages for a Session
app.get('/api/sessoes/:sessaoId/mensagens', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em ASC',
      [req.params.sessaoId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 9. Send message via Evolution API
async function sendWhatsAppMessage(number: string, text: string) {
  try {
    await axios.post(
      `${process.env.EVO_URL}/message/sendText/${process.env.EVO_INSTANCE}`,
      { number, text },
      { headers: { apikey: process.env.EVO_APIKEY } }
    );
  } catch (err: any) {
    console.error('Failed to send WhatsApp message:', err?.response?.data || err.message);
  }
}

// Detecta mensagens curtas de confirmação afirmativa do vendedor.
// Usada para evitar que o extrator reclassifique "Sim" como NEW_SESSION/unknown.
function isAffirmativeConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[!.?,]+$/g, '');
  if (normalized.length === 0 || normalized.length > 40) return false;
  return /^(sim|s|isso|isso\s+mesmo|confirmo|confirmado|pode\s+(gerar|ser|seguir|fazer)|ok|okay|👍|certo|exato|perfeito|fechado|beleza|blz|positivo|afirmativo|claro|com\s+certeza)$/.test(normalized);
}

// Detecta se a última mensagem do assistente pediu confirmação dos itens.
function lastAssistantAskedForConfirmation(history: { role: string; content: string }[]): boolean {
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  if (!lastAssistant) return false;
  return /confirme|esses\s+s[ãa]o\s+os\s+produtos|produtos\s+certos|identifiquei\s+os\s+seguintes/i.test(lastAssistant.content);
}

// 10. Evolution API Webhook
app.post('/api/webhook/evolution', async (req, res) => {
  const event = req.body;
  const ack = () => { if (!res.headersSent) res.json({ status: 'ok' }); };

  if (event.event !== 'messages.upsert') { ack(); return; }

  const key = event.data?.key;
  const msg = event.data?.message;
  if (!msg || key?.fromMe) { ack(); return; }

  const remoteJid: string = key.remoteJid || '';
  // Ignore group messages
  if (remoteJid.endsWith('@g.us')) { ack(); return; }

  // WhatsApp now uses @lid format for some users — prefer remoteJidAlt (real phone) when present.
  const phoneJid: string = key.remoteJidAlt && key.remoteJidAlt.endsWith('@s.whatsapp.net')
    ? key.remoteJidAlt
    : remoteJid;
  const senderNumber = phoneJid
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '');

  let incomingText = msg.conversation || msg.extendedTextMessage?.text || '';
  let tipoMidia: 'texto' | 'audio' | 'imagem' | 'pdf' | 'planilha' = 'texto';

  try {
    await ensureDB();

    // Audio transcription via Whisper
    const base64Data: string | undefined = msg.base64 || event.data?.message?.base64;
    if (msg.audioMessage && base64Data) {
      try {
        tipoMidia = 'audio';
        const audioBuffer = Buffer.from(base64Data, 'base64');
        const audioBlob = new Blob([audioBuffer], { type: 'audio/ogg' });
        const audioFile = new File([audioBlob], 'audio.ogg', { type: 'audio/ogg' });
        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: 'pt',
        });
        incomingText = transcription.text;
        console.log('Audio transcribed:', incomingText);
      } catch (audioErr) {
        console.error('Audio transcription failed:', audioErr);
      }
    }

    // Image processing via GPT-4o vision
    if (msg.imageMessage && base64Data) {
      try {
        tipoMidia = 'imagem';
        const imageResponse = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Esta é uma foto de uma lista de pedidos. Extraia todos os produtos e quantidades mencionados. Responda apenas com a lista de itens encontrados no formato: "Produto - Quantidade".',
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Data}` },
              },
            ],
          }],
          max_tokens: 1024,
        });
        incomingText = imageResponse.choices[0].message.content || '';
        console.log('Image processed:', incomingText);
      } catch (imgErr) {
        console.error('Image processing failed:', imgErr);
      }
    }

    if (!incomingText || incomingText.trim().length === 0) return;

    const { rows: configRows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    const config = configRows[0] || { core_prompt: '', session_timeout_hours: 2 };
    const sessionTimeoutHours = config.session_timeout_hours || 2;

    // Session Management
    const { rows: vendRows } = await pool.query(
      `INSERT INTO vendedores (numero_whatsapp) VALUES ($1) ON CONFLICT (numero_whatsapp) DO UPDATE SET ativo = true RETURNING id`,
      [senderNumber]
    );
    const vendedorId = vendRows[0].id;

    let currentSessionId: string | undefined;
    const now = new Date();

    const { rows: sessionRows } = await pool.query(
      `SELECT id, iniciada_em FROM sessoes WHERE vendedor_id = $1 AND status = 'ativa' ORDER BY iniciada_em DESC LIMIT 1`,
      [vendedorId]
    );

    if (sessionRows.length > 0) {
      const activeSession = sessionRows[0];
      const { rows: lastMsgRows } = await pool.query(
        `SELECT criado_em FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em DESC LIMIT 1`,
        [activeSession.id]
      );
      const lastMsgDate = lastMsgRows.length > 0
        ? new Date(lastMsgRows[0].criado_em)
        : new Date(activeSession.iniciada_em);
      const diffHours = (now.getTime() - lastMsgDate.getTime()) / (1000 * 60 * 60);

      if (diffHours > sessionTimeoutHours) {
        await pool.query(`UPDATE sessoes SET status = 'encerrada', encerrada_em = NOW() WHERE id = $1`, [activeSession.id]);
      } else {
        currentSessionId = activeSession.id;
      }
    }

    if (!currentSessionId) {
      const { rows: newSessionRows } = await pool.query(
        `INSERT INTO sessoes (vendedor_id) VALUES ($1) RETURNING id`,
        [vendedorId]
      );
      currentSessionId = newSessionRows[0].id;
    }

    // AI Triage
    const { rows: historicoRows } = await pool.query(
      `SELECT papel as role, conteudo FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em ASC`,
      [currentSessionId]
    );

    let historyMessages: any[] = historicoRows.map(row => ({
      role: row.role,
      content: row.conteudo,
    }));

    // Fast-path: se o vendedor está confirmando o orçamento que o bot acabou de pedir,
    // pulamos o extrator (evita NEW_SESSION/unknown falso-positivo) e reusamos os produtos
    // já apresentados na pergunta anterior.
    const isConfirmingPrevious =
      isAffirmativeConfirmation(incomingText) &&
      lastAssistantAskedForConfirmation(historyMessages);

    let searchResults: any[] = [];

    if (isConfirmingPrevious) {
      const { rows: sessRows } = await pool.query(
        `SELECT ultimos_produtos FROM sessoes WHERE id = $1`,
        [currentSessionId]
      );
      searchResults = sessRows[0]?.ultimos_produtos || [];
      console.log(`Confirmação detectada — reusando ${searchResults.length} produtos da última busca.`);
    } else {
      // Extract product terms with GPT-4o-mini
      const extractResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You receive a vendor message plus chat history. Return a comma-separated list with ONLY the product names the vendor wants to buy/query right now. ' +
              'Add "NEW_SESSION" to the list ONLY when the vendor EXPLICITLY says they want to abandon the current order and start a brand-new one — e.g. "novo pedido", "começar de novo", "esquece esse pedido", "cancela tudo", "outro pedido do zero". ' +
              'Short affirmative replies like "sim", "ok", "confirmo", "isso", "pode gerar", "👍" are NEVER a new session — they confirm the previous question. In those cases return "unknown". ' +
              'If no product is mentioned and there is no explicit reset request, return "unknown".',
          },
          ...historyMessages,
          { role: 'user', content: incomingText },
        ],
      });

      const extractedContent = extractResponse.choices[0].message.content || 'unknown';

      if (extractedContent.includes('NEW_SESSION')) {
        await pool.query(`UPDATE sessoes SET status = 'encerrada', encerrada_em = NOW() WHERE id = $1`, [currentSessionId]);
        const { rows: newSessionRows } = await pool.query(
          `INSERT INTO sessoes (vendedor_id) VALUES ($1) RETURNING id`,
          [vendedorId]
        );
        currentSessionId = newSessionRows[0].id;
        historyMessages = [];
      }

      // Fuzzy Search (pg_trgm)
      const termsToSearch = extractedContent
        .split(',')
        .map(s => s.replace('NEW_SESSION', '').trim())
        .filter(s => s.length > 0 && s !== 'unknown');

      for (const term of termsToSearch) {
        const { rows } = await pool.query(`
          SELECT id, codigo, descricao, preco_venda, marca, embalagem,
                 similarity(descricao, $1) as sml
          FROM products
          WHERE ativo = true AND similarity(descricao, $1) > 0.1
          ORDER BY similarity(descricao, $1) DESC
          LIMIT 5
        `, [term]);
        searchResults = searchResults.concat(rows);
      }

      // Persiste os produtos encontrados na sessão para que uma confirmação posterior
      // ("Sim", "Confirmo", etc.) consiga reusá-los sem precisar buscar de novo.
      if (searchResults.length > 0) {
        await pool.query(
          `UPDATE sessoes SET ultimos_produtos = $1 WHERE id = $2`,
          [JSON.stringify(searchResults), currentSessionId]
        );
      }
    }

    // Registra a mensagem do vendedor APÓS o fluxo de extração/confirmação,
    // mas usando o currentSessionId final (que pode ter sido trocado por NEW_SESSION).
    await pool.query(
      `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
      [currentSessionId, vendedorId, 'user', incomingText, tipoMidia]
    );
    historyMessages.push({ role: 'user', content: incomingText });

    // Build final response
    const finalPrompt = `Você é o assistente virtual da Win Distribuidora, atendendo representantes de vendas via WhatsApp.
Você é responsável por todo o processo: entender o pedido, confirmar os itens encontrados no estoque e gerar o orçamento final. NÃO há atendente humano.

REGRAS OBRIGATÓRIAS:
${config.core_prompt}

Produtos encontrados no estoque (com preços):
${JSON.stringify(searchResults.map(p => ({ descricao: p.descricao, marca: p.marca, preco_venda: p.preco_venda })))}

Instruções:
1. Compare os produtos solicitados com os "Produtos encontrados".
2. Se for um novo pedido ou os itens ainda não foram confirmados, pergunte ao vendedor se os produtos encontrados são os corretos.
3. Mantenha o controle das quantidades solicitadas.
4. Após a confirmação dos itens, calcule o total e gere o orçamento completo.
5. NÃO invente produto ou preço que não esteja na lista. Se não encontrar, informe que o item não está em estoque.
6. Responda SEMPRE em português do Brasil.

FORMATAÇÃO — MUITO IMPORTANTE (você está no WhatsApp, NÃO use tabelas markdown com |):

Para CONFIRMAR itens, use este formato:
Identifiquei os seguintes itens no estoque:

✅ *[Nome do Produto – Marca]* × [Qtd] un.
✅ *[Nome do Produto – Marca]* × [Qtd] un.

Esses são os produtos certos? Confirme para eu gerar o orçamento! 👍

Para GERAR O ORÇAMENTO, use este formato (nunca use tabela com |):
📋 *ORÇAMENTO WIN DISTRIBUIDORA*
—————————————————
*1.* [Nome – Marca]
Qtd: [N] un. × R$ [X] = *R$ [Y]*

*2.* [Nome – Marca]
Qtd: [N] un. × R$ [X] = *R$ [Y]*
—————————————————
💰 *TOTAL: R$ [Z]*
—————————————————

Há mais algum item para adicionar?`;

    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: finalPrompt },
        ...historyMessages,
      ],
    });

    const replyText = finalResponse.choices[0].message.content;

    if (replyText) {
      await sendWhatsAppMessage(senderNumber, replyText);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
      );
    }
  } catch (err: any) {
    console.error('Error processing webhook:', err);
  } finally {
    ack();
  }
});

// 11. Configure Webhook
app.post('/api/setup-webhook', async (req, res) => {
  const { appUrl } = req.body;
  try {
    const webhookPayload = {
      webhook: {
        enabled: true,
        url: `${appUrl}/api/webhook/evolution`,
        webhookByEvents: false,
        webhookBase64: true,
        events: ['MESSAGES_UPSERT'],
      },
    };
    const response = await axios.post(
      `${process.env.EVO_URL}/webhook/set/${process.env.EVO_INSTANCE}`,
      webhookPayload,
      { headers: { apikey: process.env.EVO_APIKEY } }
    );
    res.json({ success: true, data: response.data });
  } catch (err: any) {
    console.error('Webhook setup failed:', err?.response?.data || err.message);
    res.status(500).json({ error: err?.response?.data || err.message });
  }
});

// --- Server Startup (local dev / production self-hosted) ---
export async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;

// Only start the server when run directly (not imported as a module by Vercel)
if (!process.env.VERCEL) {
  startServer();
}
