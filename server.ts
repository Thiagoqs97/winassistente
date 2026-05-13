import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
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
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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

    await client.query(`ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE mensagens DISABLE ROW LEVEL SECURITY;`);

    const defaultPrompt = `1. O agente tem acesso ao histórico completo da sessão ativa e deve utilizá-lo para entender pedidos construídos em múltiplas mensagens.
2. O agente confirma os itens identificados antes de gerar qualquer orçamento, perguntando ao vendedor se os produtos encontrados correspondem ao que foi solicitado.
3. O agente gera e envia o orçamento completo após a confirmação dos itens, calculando o total, sem necessidade de intervenção humana.
4. O agente não mistura contextos de sessões diferentes — quando detecta o início de um novo pedido, trata-o de forma totalmente isolada.
5. O agente nunca inventa produtos — trabalha exclusivamente com os itens retornados pela busca no estoque.
6. Sempre responda de forma final com a tabela do orçamento quando os itens forem confirmados.`;

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

// Middleware: ensure DB is ready before any request
app.use(async (_req, _res, next) => {
  try {
    await ensureDB();
    next();
  } catch (err) {
    next(err);
  }
});

// --- API ROUTES ---

// 1. Upload Stock (XLSX)
app.post('/api/upload-stock', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawData = xlsx.utils.sheet_to_json(sheet) as Record<string, any>[];

    let inserted = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const row of rawData) {
        const getVal = (exactKeys: string[], partialKeys: string[]) => {
          let key = Object.keys(row).find(k =>
            exactKeys.some(ek => k.trim().toLowerCase() === ek.toLowerCase())
          );
          if (!key) {
            key = Object.keys(row).find(k =>
              partialKeys.some(pk => k.toLowerCase().includes(pk))
            );
          }
          return key ? row[key] : null;
        };

        const codigo = getVal(['código', 'codigo', 'cod', 'sku'], ['códig', 'codig']);
        const descricao = getVal(['descrição', 'descricao', 'desc'], ['descri']);
        const precoRaw = getVal(
          ['venda', 'preço de venda', 'preco de venda', 'preço', 'preco', 'valor'],
          ['preço de venda', 'preco de venda', 'preço', 'preco', 'valor']
        );
        const marca = getVal(['marca'], ['marca']);
        const embalagem = getVal(['embalagem', 'emb'], ['embalagem']);

        if (!codigo || !descricao) continue;

        let preco = null;
        if (typeof precoRaw === 'number') {
          preco = precoRaw;
        } else if (typeof precoRaw === 'string') {
          const cleaned = precoRaw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
          preco = parseFloat(cleaned);
        }

        await client.query(`
          INSERT INTO products (codigo, descricao, preco_venda, marca, embalagem)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (codigo) DO UPDATE
          SET descricao = EXCLUDED.descricao,
              preco_venda = EXCLUDED.preco_venda,
              marca = EXCLUDED.marca,
              embalagem = EXCLUDED.embalagem,
              ativo = true;
        `, [String(codigo), String(descricao), preco, marca ? String(marca) : null, embalagem ? String(embalagem) : null]);

        inserted++;
      }

      await client.query('COMMIT');
      res.json({ message: `Importados ${inserted} produtos com sucesso.` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
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

// 10. Evolution API Webhook
app.post('/api/webhook/evolution', async (req, res) => {
  res.json({ status: 'ok' });

  const event = req.body;

  if (event.event !== 'messages.upsert') return;

  const msg = event.data?.message;
  if (!msg || msg.fromMe) return;

  const senderNumber = event.data.key.remoteJid;

  let incomingText = msg.conversation || msg.extendedTextMessage?.text || '';
  let tipoMidia: 'texto' | 'audio' | 'imagem' | 'pdf' | 'planilha' = 'texto';

  try {
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

    // Extract product terms with GPT-4o-mini
    const extractResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Given the user message and history, extract a comma-separated list of ONLY the product names the user wants to buy/query. If they explicitly state they want to start a new order/session, add "NEW_SESSION" to the list. If no product is mentioned and no new session, return "unknown".',
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

    await pool.query(
      `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
      [currentSessionId, vendedorId, 'user', incomingText, tipoMidia]
    );
    historyMessages.push({ role: 'user', content: incomingText });

    // Fuzzy Search (pg_trgm)
    let searchResults: any[] = [];
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
4. Após a confirmação dos itens, calcule o total e gere o orçamento completo: Produto, Quantidade, Preço Unitário e Total.
5. NÃO invente produto ou preço que não esteja na lista. Se não encontrar, informe que o item não está em estoque.
6. Responda SEMPRE em português do Brasil.`;

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
