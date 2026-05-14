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
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;');

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
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao_lower
      ON products USING GIN (lower(descricao) gin_trgm_ops);
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
        status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada', 'orcamento_gerado')),
        acao_pendente JSONB
      );
    `);
    await client.query(`ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS acao_pendente JSONB;`);

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

    await client.query(`CREATE SEQUENCE IF NOT EXISTS orcamento_numero_seq START 1;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orcamentos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        numero TEXT UNIQUE NOT NULL,
        sessao_id UUID REFERENCES sessoes(id) ON DELETE SET NULL,
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
        cliente_nome TEXT,
        itens JSONB NOT NULL,
        total NUMERIC(10, 2) NOT NULL,
        status TEXT DEFAULT 'aberto',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP;`);

    // Migra status antigo: 'finalizado' -> 'aberto' (e CHECK constraint para o novo enum)
    await client.query(`UPDATE orcamentos SET status = 'aberto' WHERE status = 'finalizado';`);
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'orcamentos' AND constraint_name = 'orcamentos_status_check'
        ) THEN
          ALTER TABLE orcamentos DROP CONSTRAINT orcamentos_status_check;
        END IF;
      END $$;
    `);
    await client.query(`
      ALTER TABLE orcamentos
      ADD CONSTRAINT orcamentos_status_check
      CHECK (status IN ('aberto', 'venda', 'cancelado'));
    `);
    await client.query(`ALTER TABLE orcamentos ALTER COLUMN status SET DEFAULT 'aberto';`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor ON orcamentos(vendedor_id, criado_em DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_numero ON orcamentos(numero);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(lower(cliente_nome));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor_status ON orcamentos(vendedor_id, status, criado_em DESC);`);

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

// 8b. Orçamentos: list with filters
app.get('/api/orcamentos', async (req, res) => {
  try {
    const { numero, vendedor_id, cliente_nome, data_de, data_ate, status } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
    const offset = parseInt((req.query.offset as string) || '0');

    const conds: string[] = [];
    const params: any[] = [];
    const push = (sql: string, val: any) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };

    if (numero) push('o.numero ILIKE ?', `%${numero}%`);
    if (vendedor_id) push('o.vendedor_id = ?', vendedor_id);
    if (cliente_nome) push('lower(o.cliente_nome) LIKE ?', `%${cliente_nome.toLowerCase()}%`);
    if (data_de) push('o.criado_em >= ?', data_de);
    if (data_ate) push('o.criado_em <= ?', data_ate);
    if (status) push('o.status = ?', status);

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT o.id, o.numero, o.cliente_nome, o.total, o.status, o.criado_em,
              o.vendedor_id, v.numero_whatsapp AS vendedor_whatsapp, v.nome AS vendedor_nome,
              jsonb_array_length(o.itens) AS qtd_itens
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       ${where}
       ORDER BY o.criado_em DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/orcamentos error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// 8c. Orçamento: detail by numero
app.get('/api/orcamentos/:numero', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, v.numero_whatsapp AS vendedor_whatsapp, v.nome AS vendedor_nome
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       WHERE o.numero = $1`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 8d. Orçamento: cancelar
app.patch('/api/orcamentos/:numero/cancelar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'cancelado', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 8e. Orçamento: fechar como venda
app.patch('/api/orcamentos/:numero/fechar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'venda', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// 8f. Orçamento: reabrir
app.patch('/api/orcamentos/:numero/reabrir', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'aberto', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// --- Onboarding: parse de nome do vendedor a partir da mensagem ---
// Aceita textos como "João", "meu nome é Maria", "sou o Pedro", "aqui é a Ana".
// Rejeita textos que parecem pedido/produto (muito longos, com números/preços).
function parseNomeVendedor(text: string): string | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(
    /^(meu nome (e|é)\s*:?\s*|me chamo\s+|sou (o |a )?|aqui (e|é) (o |a )?|nome\s*:?\s*|eu sou (o |a )?)/i,
    ''
  ).trim();
  cleaned = cleaned.replace(/[.!?,;]+$/, '').trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  // Rejeita se tem dígito (provavelmente é produto/preço/quantidade)
  if (/\d/.test(cleaned)) return null;
  // Deve ser majoritariamente letras+espaços (até 3 palavras, padrão de nome)
  if (!/^[\p{L}][\p{L}\s'-]{1,}$/u.test(cleaned)) return null;
  const palavras = cleaned.split(/\s+/);
  if (palavras.length > 5) return null;
  return palavras
    .map(w => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR'))
    .join(' ');
}

// --- Confirmação sim/não para ações pendentes (fechar venda / cancelar) ---
function parseConfirmacao(text: string): 'sim' | 'nao' | 'ambiguo' {
  const t = text.trim().toLowerCase().replace(/[.!?,;]+$/, '');
  if (/^(sim|s|ok|pode|isso|confirma|confirmo|confirmar|positivo|claro|fecha|manda|vai|sim por favor|sim pode|com certeza|certeza)\b/.test(t)) return 'sim';
  if (/^(nao|não|n|negativo|cancela isso|esquece|deixa|nem|para|pare|errado|nao quero|não quero)\b/.test(t)) return 'nao';
  return 'ambiguo';
}

// --- Normaliza "123" / "ORC-7" / "orc 45" → "ORC-000123" ---
function normalizarNumeroOrcamento(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const digits = String(ref).replace(/\D/g, '');
  if (!digits) return null;
  return `ORC-${digits.padStart(6, '0')}`;
}

// --- Format texto de orçamento (reusado por finalizar e alterar) ---
function formatarTextoOrcamento(opts: {
  numero: string;
  clienteNome: string | null;
  itens: any[];
  total: number;
  cabecalho?: string;
  rodape?: string;
}): string {
  const fmtBR = (n: number) => n.toFixed(2).replace('.', ',');
  const linhas = opts.itens.map((it: any, i: number) => {
    const nome = String(it.descricao ?? '').trim();
    const marca = String(it.marca ?? '').trim();
    const nomeUpper = nome.toUpperCase();
    const marcaJaNoNome = marca && nomeUpper.includes(marca.toUpperCase());
    const nomeMarca = marca && !marcaJaNoNome ? `${nome} - ${marca}` : nome;
    const qtd = Number(it.qtd ?? 0);
    const pu = Number(it.preco_unit ?? 0);
    const sub = Number(it.subtotal ?? qtd * pu);
    return `${i + 1}. ${nomeMarca}\n   Qtd: ${qtd} un. x R$ ${fmtBR(pu)} = R$ ${fmtBR(sub)}`;
  }).join('\n\n');

  const cabecalho = opts.cabecalho || `📋 *ORÇAMENTO ${opts.numero}*`;
  const rodape = opts.rodape || `Orçamento ${opts.numero} salvo. Para um novo atendimento, é só enviar uma nova mensagem.`;

  return `${cabecalho}
—————————————————${opts.clienteNome ? `\nCliente: ${opts.clienteNome}` : ''}

${linhas}
—————————————————
💰 *TOTAL: R$ ${fmtBR(opts.total)}*
—————————————————

${rodape}`;
}

// --- Multi-strategy product search ---
// Limite alto por termo: quando o vendedor pergunta "quais sabores do X", precisamos
// retornar TODAS as variações; 30 cobre listas grandes sem estourar o prompt.
const MAX_PER_TERM = 30;

// Stop words PT-BR que não ajudam na busca por produto
const STOP_WORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'por',
  'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'o', 'a', 'os', 'as',
]);

// Normaliza o termo de busca:
// - "300g" / "300gr" / "300gramas" → "300 g" (separa número e unidade)
// - "1kg" → "1 kg"
// - "500ml" → "500 ml"
// - Remove pontuação que atrapalha o split
function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/(\d+)\s*(gramas?|gr|g)\b/gi, '$1 g')
    .replace(/(\d+)\s*(quilos?|kgs?|kg)\b/gi, '$1 kg')
    .replace(/(\d+)\s*(mililitros?|ml)\b/gi, '$1 ml')
    .replace(/(\d+)\s*(litros?|lts?|l)\b/gi, '$1 l')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extrai palavras-chave significativas do termo normalizado
// - palavras-texto (>= 3 chars, não stop word): peso ALTO, exigidas (AND)
// - números/unidades: peso BAIXO, opcionais (filtragem soft no rank)
function extractKeywords(normalized: string): { strong: string[]; weak: string[] } {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const strong: string[] = [];
  const weak: string[] = [];
  for (const tok of tokens) {
    if (STOP_WORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) {
      weak.push(tok);
    } else if (tok.length >= 3) {
      strong.push(tok);
    } else if (/^(g|kg|ml|l)$/i.test(tok)) {
      weak.push(tok.toLowerCase());
    }
  }
  return { strong, weak };
}

async function searchProducts(terms: string[]): Promise<{ term: string; products: any[] }[]> {
  if (terms.length === 0) return [];

  const byTerm = new Map<string, Map<number, any>>(terms.map(t => [t, new Map()]));

  // Strategy 1+2 (batched): trigram similarity + substring ILIKE no termo inteiro
  // Tie-break determinístico (ORDER BY sml DESC, p.id ASC) — sem ele a ordem muda
  // entre queries quando vários produtos têm a mesma similaridade, devolvendo top-N
  // diferentes a cada chamada.
  const { rows: batchRows } = await pool.query(`
    WITH term_list AS (SELECT UNNEST($1::text[]) AS term),
    matches AS (
      SELECT
        p.id, p.codigo, p.descricao, p.preco_venda, p.marca, p.embalagem,
        t.term,
        GREATEST(
          similarity(unaccent(lower(p.descricao)), unaccent(lower(t.term))),
          CASE WHEN unaccent(lower(p.descricao)) ILIKE '%' || unaccent(lower(t.term)) || '%'
               THEN 0.5 ELSE 0 END
        ) AS sml
      FROM products p
      CROSS JOIN term_list t
      WHERE p.ativo = true
        AND (
          similarity(unaccent(lower(p.descricao)), unaccent(lower(t.term))) > 0.08
          OR unaccent(lower(p.descricao)) ILIKE '%' || unaccent(lower(t.term)) || '%'
        )
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY term ORDER BY sml DESC, id ASC) AS rn
      FROM matches
    )
    SELECT id, codigo, descricao, preco_venda, marca, embalagem, term, sml
    FROM ranked WHERE rn <= $2
  `, [terms, MAX_PER_TERM]);

  for (const row of batchRows) {
    const m = byTerm.get(row.term);
    if (m && !m.has(row.id)) m.set(row.id, row);
  }

  // Strategy 3: keyword-based ILIKE — SEMPRE roda para termos multi-palavra.
  // Faz AND nas palavras-fortes (nome do produto, marca) e bonifica matches
  // que contêm também os números/unidades. Isso permite encontrar
  // "Creatina Dux 300 gramas" a partir de "creatina dux 300g".
  for (const term of terms) {
    const m = byTerm.get(term)!;
    const { strong, weak } = extractKeywords(normalizeTerm(term));

    if (strong.length === 0) continue;

    // Monta condição AND nas palavras fortes
    const strongConds = strong
      .map((_, i) => `unaccent(lower(descricao)) ILIKE '%' || unaccent(lower($${i + 1})) || '%'`)
      .join(' AND ');

    // Bônus de similaridade por cada palavra-fraca (número/unidade) presente
    const weakBonusExpr = weak.length > 0
      ? weak.map((_, i) =>
          `(CASE WHEN unaccent(lower(descricao)) ILIKE '%' || unaccent(lower($${strong.length + i + 1})) || '%' THEN 0.1 ELSE 0 END)`
        ).join(' + ')
      : '0';

    const { rows: kwRows } = await pool.query(
      `SELECT id, codigo, descricao, preco_venda, marca, embalagem,
              (0.3 + ${weakBonusExpr})::float AS sml
       FROM products
       WHERE ativo = true AND (${strongConds})
       ORDER BY sml DESC, id ASC
       LIMIT $${strong.length + weak.length + 1}`,
      [...strong, ...weak, MAX_PER_TERM]
    );

    for (const row of kwRows) {
      const existing = m.get(row.id);
      if (!existing) {
        m.set(row.id, { ...row, term });
      } else if (row.sml > existing.sml) {
        // Strategy 3 deu sml maior — atualiza para subir no ranking final
        m.set(row.id, { ...row, term });
      }
    }
  }

  return terms.map(term => ({
    term,
    products: Array.from(byTerm.get(term)!.values())
      .sort((a, b) => (b.sml - a.sml) || (a.id - b.id))
      .slice(0, MAX_PER_TERM),
  }));
}

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

    // Excel/CSV spreadsheet from WhatsApp (vendor sending order list as file)
    if (msg.documentMessage && base64Data && !incomingText) {
      try {
        const mimeType: string = msg.documentMessage.mimetype || '';
        const fileName: string = msg.documentMessage.fileName || '';
        if (
          mimeType.includes('spreadsheet') ||
          mimeType.includes('excel') ||
          /\.(xlsx|xls)$/i.test(fileName)
        ) {
          tipoMidia = 'planilha';
          const buffer = Buffer.from(base64Data, 'base64');
          const workbook = xlsx.read(buffer, { type: 'buffer' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const sheetRows = xlsx.utils.sheet_to_json(sheet, { defval: '', header: 1 }) as any[][];
          const lines = sheetRows
            .slice(0, 200)
            .map((r: any[]) => r.filter((c: any) => String(c).trim() !== '').join(' | '))
            .filter((l: string) => l.trim().length > 0);
          incomingText = `Pedido recebido em planilha:\n${lines.join('\n')}`;
          console.log('[doc] Planilha processada:', lines.length, 'linhas');
        } else if (/\.csv$/i.test(fileName) || mimeType.includes('csv')) {
          tipoMidia = 'planilha';
          incomingText = `Pedido recebido em CSV:\n${Buffer.from(base64Data, 'base64').toString('utf-8').slice(0, 4000)}`;
          console.log('[doc] CSV processado');
        }
      } catch (docErr) {
        console.error('[doc] Erro ao processar documento:', docErr);
      }
    }

    if (!incomingText || incomingText.trim().length === 0) return;

    const { rows: configRows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    const config = configRows[0] || { core_prompt: '', session_timeout_hours: 2 };
    const sessionTimeoutHours = config.session_timeout_hours || 2;

    // Session Management
    const { rows: vendRows } = await pool.query(
      `INSERT INTO vendedores (numero_whatsapp) VALUES ($1)
       ON CONFLICT (numero_whatsapp) DO UPDATE SET ativo = true
       RETURNING id, nome`,
      [senderNumber]
    );
    const vendedorId = vendRows[0].id;
    let vendedorNome: string | null = vendRows[0].nome;

    let currentSessionId: string | undefined;
    const now = new Date();

    const { rows: sessionRows } = await pool.query(
      `SELECT id, iniciada_em, status FROM sessoes WHERE vendedor_id = $1 AND status = 'ativa' ORDER BY iniciada_em DESC LIMIT 1`,
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

    // --- Onboarding: vendedor sem nome cadastrado ---
    // Bloqueia todo o fluxo de pedido até termos um nome salvo.
    if (!vendedorNome) {
      // Registra a mensagem recebida antes de decidir o que responder
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'user', incomingText, tipoMidia]
      );

      // Já perguntamos o nome antes? Conta respostas anteriores do assistant na sessão.
      const { rows: askCountRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM mensagens WHERE sessao_id = $1 AND papel = 'assistant'`,
        [currentSessionId]
      );
      const jaPerguntou = askCountRows[0].n > 0;

      let reply: string;
      if (!jaPerguntou) {
        reply = 'Olá! 👋 Sou o assistente da Win Distribuidora.\n\nAntes de começarmos, qual é o seu nome? (assim eu vincular seus orçamentos corretamente)';
      } else {
        const nomeExtraido = parseNomeVendedor(incomingText);
        if (nomeExtraido) {
          await pool.query(`UPDATE vendedores SET nome = $1 WHERE id = $2`, [nomeExtraido, vendedorId]);
          vendedorNome = nomeExtraido;
          reply = `Prazer, ${nomeExtraido}! 🎯\n\nAgora é só me mandar o pedido que eu monto o orçamento. Lembre de informar o nome do cliente também.`;
        } else {
          reply = 'Não consegui identificar seu nome. Pode me mandar só o nome, por favor? (ex: "João Silva")';
        }
      }

      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return;
    }

    // --- Confirmação pendente (fechar venda / cancelar) ---
    const { rows: pendRows } = await pool.query(
      `SELECT acao_pendente FROM sessoes WHERE id = $1`,
      [currentSessionId]
    );
    const acaoPendente: { tipo?: string; numero?: string } | null = pendRows[0]?.acao_pendente || null;
    if (acaoPendente && acaoPendente.tipo && acaoPendente.numero) {
      const conf = parseConfirmacao(incomingText);
      if (conf === 'sim' || conf === 'nao') {
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'user', incomingText, tipoMidia]
        );

        let reply: string;
        if (conf === 'sim') {
          if (acaoPendente.tipo === 'fechar_venda') {
            const { rowCount } = await pool.query(
              `UPDATE orcamentos SET status = 'venda', atualizado_em = NOW()
               WHERE numero = $1 AND vendedor_id = $2 AND status = 'aberto'`,
              [acaoPendente.numero, vendedorId]
            );
            reply = (rowCount ?? 0) > 0
              ? `✅ *${acaoPendente.numero}* marcado como VENDA. 🎉`
              : `Não consegui fechar o ${acaoPendente.numero} — talvez já tenha sido fechado ou cancelado.`;
          } else if (acaoPendente.tipo === 'cancelar') {
            const { rowCount } = await pool.query(
              `UPDATE orcamentos SET status = 'cancelado', atualizado_em = NOW()
               WHERE numero = $1 AND vendedor_id = $2 AND status = 'aberto'`,
              [acaoPendente.numero, vendedorId]
            );
            reply = (rowCount ?? 0) > 0
              ? `🚫 *${acaoPendente.numero}* cancelado.`
              : `Não consegui cancelar o ${acaoPendente.numero} — talvez já tenha sido fechado ou cancelado.`;
          } else {
            reply = 'Ação não reconhecida.';
          }
        } else {
          reply = `Ok, mantive o *${acaoPendente.numero}* como está. 👍`;
        }
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      // Ambíguo: limpa pending e segue fluxo normal (vendedor mudou de assunto)
      await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
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

    // Extract product terms — usa CONVERSA COMPLETA para extrair produtos
    // Resposta em JSON estruturado + temperature 0 para garantir determinismo e impedir
    // que o modelo "responda" como chatbot ou alucine variações.
    const extractResponse = await openai.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Você NÃO é um chatbot. Você é um CLASSIFICADOR DE INTENÇÃO + EXTRATOR. Sua ÚNICA saída é um JSON com a estrutura abaixo. NUNCA responda em texto livre.

SAÍDA (JSON obrigatório):
{
  "intent": "pedido" | "listar_abertos" | "buscar_por_cliente" | "fechar_venda" | "cancelar_orcamento" | "alterar_orcamento" | "outro",
  "new_session": boolean,        // true SOMENTE se o vendedor pediu novo pedido / outro cliente explicitamente
  "ref_numero": string | null,   // se citou um nº de orçamento (ex: "ORC-000123", "123", "o orçamento 45"). Devolva os DÍGITOS apenas: "123", "45". null se não citou.
  "cliente_busca": string | null,// se intent=buscar_por_cliente, nome a buscar. null caso contrário.
  "terms": string[]              // termos de busca de produto, em minúsculas. Use SÓ para intent=pedido ou alterar_orcamento.
}

DEFINIÇÃO DOS INTENTS:
- "pedido": vendedor está montando um orçamento novo (citando produtos, quantidades, confirmando itens, perguntando preço/variações). Default na dúvida.
- "listar_abertos": vendedor pergunta seus orçamentos em aberto / em negociação ("quais orçamentos estão abertos?", "lista meus orçamentos", "o que tenho em negociação", "quais orçamentos não fechei ainda").
- "buscar_por_cliente": vendedor pede orçamentos de um cliente pelo nome ("orçamentos do João", "tenho algum orçamento da Maria?", "busca orçamentos do Pedro Silva"). Preencha cliente_busca com o nome.
- "fechar_venda": vendedor quer marcar um orçamento como venda fechada ("fechei o ORC-123", "marca o 45 como venda", "o 123 virou venda", "vendi o orçamento 7"). Preencha ref_numero.
- "cancelar_orcamento": vendedor quer cancelar um orçamento ("cancela o ORC-123", "cancela o 45", "esquece o orçamento 7"). Preencha ref_numero.
- "alterar_orcamento": vendedor quer modificar um orçamento já gerado ("adiciona 2 whey no ORC-123", "muda a quantidade do 45", "tira o tasty do 7", "no 123 troca o sabor"). Preencha ref_numero E terms (novos produtos/itens citados).
- "outro": saudação, agradecimento, dúvida geral, mensagem sem ação clara.

REGRAS PARA "terms" (só preencher quando intent="pedido" ou "alterar_orcamento"):
1. Use APENAS o nome-base do produto. NÃO invente sabor, gramatura, marca.
2. Citou múltiplos produtos? Liste todos.
3. Considere a conversa inteira. Confirmações ("sim","ok","isso") OU perguntas de detalhe ("qual sabor?","tem maior?") → repita os mesmos termos do último pedido.
4. Planilha/CSV: extraia todos os produtos.
5. Sem produto explícito (saudação, listar, fechar, cancelar) → terms = [].

EXEMPLOS:
- "Quais os sabores do TASTY WHEY?" → {"intent":"pedido","new_session":false,"ref_numero":null,"cliente_busca":null,"terms":["tasty whey"]}
- "Quais orçamentos estão abertos?" → {"intent":"listar_abertos","new_session":false,"ref_numero":null,"cliente_busca":null,"terms":[]}
- "Lista meus orçamentos em negociação" → {"intent":"listar_abertos","new_session":false,"ref_numero":null,"cliente_busca":null,"terms":[]}
- "Tenho algum orçamento do João?" → {"intent":"buscar_por_cliente","new_session":false,"ref_numero":null,"cliente_busca":"joão","terms":[]}
- "Busca orçamentos da Maria Silva" → {"intent":"buscar_por_cliente","new_session":false,"ref_numero":null,"cliente_busca":"maria silva","terms":[]}
- "Fechei o ORC-000123" → {"intent":"fechar_venda","new_session":false,"ref_numero":"123","cliente_busca":null,"terms":[]}
- "marca o 45 como venda" → {"intent":"fechar_venda","new_session":false,"ref_numero":"45","cliente_busca":null,"terms":[]}
- "cancela o ORC-7" → {"intent":"cancelar_orcamento","new_session":false,"ref_numero":"7","cliente_busca":null,"terms":[]}
- "adiciona 2 whey gold no ORC-123" → {"intent":"alterar_orcamento","new_session":false,"ref_numero":"123","cliente_busca":null,"terms":["whey gold"]}
- "Bom dia" → {"intent":"outro","new_session":false,"ref_numero":null,"cliente_busca":null,"terms":[]}
- "esquece, novo pedido pra outro cliente" → {"intent":"pedido","new_session":true,"ref_numero":null,"cliente_busca":null,"terms":[]}`,
        },
        ...historyMessages,
        { role: 'user', content: incomingText },
      ],
    });

    const rawExtract = extractResponse.choices[0].message.content || '{}';
    let parsedExtract: {
      intent?: string;
      new_session?: boolean;
      ref_numero?: string | null;
      cliente_busca?: string | null;
      terms?: string[];
    } = {};
    try {
      parsedExtract = JSON.parse(rawExtract);
    } catch {
      console.error('[extract] JSON parse failed, raw:', rawExtract);
    }
    const intent = (parsedExtract.intent as string) || 'pedido';
    const newSession = parsedExtract.new_session === true;
    const refNumero = parsedExtract.ref_numero ? String(parsedExtract.ref_numero).trim() : null;
    const clienteBusca = parsedExtract.cliente_busca ? String(parsedExtract.cliente_busca).trim() : null;
    const extractedTerms = Array.isArray(parsedExtract.terms) ? parsedExtract.terms : [];
    console.log('[extract]', { incomingText, intent, newSession, refNumero, clienteBusca, extractedTerms });

    if (newSession) {
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

    // --- Roteamento de intents administrativas (respostas determinísticas, sem agente) ---
    const fmtBRn = (n: any) => Number(n ?? 0).toFixed(2).replace('.', ',');

    if (intent === 'listar_abertos') {
      const { rows: abertos } = await pool.query(
        `SELECT numero, cliente_nome, total, criado_em FROM orcamentos
         WHERE vendedor_id = $1 AND status = 'aberto'
         ORDER BY criado_em DESC LIMIT 30`,
        [vendedorId]
      );
      const reply = abertos.length === 0
        ? `Você não tem orçamentos em aberto no momento, ${vendedorNome}. 👍`
        : `Seus orçamentos em aberto (${abertos.length}):\n\n` +
          abertos.map((o, i) =>
            `${i + 1}. *${o.numero}* — ${o.cliente_nome || 'sem cliente'} — R$ ${fmtBRn(o.total)}`
          ).join('\n') +
          `\n\nPara fechar como venda, mande: "fechei o ${abertos[0].numero}". Para cancelar: "cancela o ${abertos[0].numero}".`;
      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return;
    }

    if (intent === 'buscar_por_cliente') {
      if (!clienteBusca) {
        const reply = 'Qual o nome do cliente que você quer buscar?';
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      const { rows: matches } = await pool.query(
        `SELECT numero, cliente_nome, total, status, criado_em FROM orcamentos
         WHERE vendedor_id = $1 AND unaccent(lower(cliente_nome)) LIKE unaccent(lower($2))
         ORDER BY criado_em DESC LIMIT 30`,
        [vendedorId, `%${clienteBusca}%`]
      );
      const statusLabel: Record<string, string> = {
        aberto: '🟡 aberto',
        venda: '✅ venda',
        cancelado: '🚫 cancelado',
      };
      const reply = matches.length === 0
        ? `Não encontrei orçamentos para "${clienteBusca}".`
        : `Orçamentos de "${clienteBusca}" (${matches.length}):\n\n` +
          matches.map((o, i) =>
            `${i + 1}. *${o.numero}* — ${o.cliente_nome} — R$ ${fmtBRn(o.total)} — ${statusLabel[o.status] || o.status}`
          ).join('\n');
      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return;
    }

    if (intent === 'fechar_venda' || intent === 'cancelar_orcamento') {
      const numeroNorm = normalizarNumeroOrcamento(refNumero);
      if (!numeroNorm) {
        const reply = intent === 'fechar_venda'
          ? 'Qual orçamento você quer fechar como venda? (ex: "fechei o ORC-000123")'
          : 'Qual orçamento você quer cancelar? (ex: "cancela o ORC-000123")';
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      const { rows: orcRows } = await pool.query(
        `SELECT numero, cliente_nome, total, status FROM orcamentos
         WHERE numero = $1 AND vendedor_id = $2`,
        [numeroNorm, vendedorId]
      );
      if (orcRows.length === 0) {
        const reply = `Não achei o ${numeroNorm} nos seus orçamentos. Confira o número.`;
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      const orc = orcRows[0];
      if (orc.status !== 'aberto') {
        const statusTxt = orc.status === 'venda' ? 'fechado como venda' : 'cancelado';
        const reply = `O ${numeroNorm} já está ${statusTxt}. Nada a fazer.`;
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      const tipoAcao = intent === 'fechar_venda' ? 'fechar_venda' : 'cancelar';
      await pool.query(
        `UPDATE sessoes SET acao_pendente = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ tipo: tipoAcao, numero: numeroNorm }), currentSessionId]
      );
      const verbo = intent === 'fechar_venda' ? 'fechar como *VENDA*' : 'cancelar';
      const reply = `Confirma ${verbo} o *${numeroNorm}*?\n\nCliente: ${orc.cliente_nome || '—'}\nTotal: R$ ${fmtBRn(orc.total)}\n\nResponda *sim* ou *não*.`;
      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return;
    }

    // --- Modo alteração: carrega orçamento alvo e valida ---
    let orcamentoEmAlteracao: {
      numero: string;
      cliente_nome: string | null;
      itens: any[];
      total: number;
    } | null = null;

    if (intent === 'alterar_orcamento') {
      const numeroNorm = normalizarNumeroOrcamento(refNumero);
      if (!numeroNorm) {
        const reply = 'Qual orçamento você quer alterar? Me passa o número (ex: "ORC-000123").';
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      const { rows: orcRows } = await pool.query(
        `SELECT numero, cliente_nome, itens, total, status FROM orcamentos
         WHERE numero = $1 AND vendedor_id = $2`,
        [numeroNorm, vendedorId]
      );
      if (orcRows.length === 0) {
        const reply = `Não achei o ${numeroNorm} nos seus orçamentos.`;
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      if (orcRows[0].status !== 'aberto') {
        const statusTxt = orcRows[0].status === 'venda' ? 'fechado como venda' : 'cancelado';
        const reply = `Não dá pra alterar o ${numeroNorm} — ele já está ${statusTxt}.`;
        await sendWhatsAppMessage(senderNumber, reply);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', reply, 'texto']
        );
        return;
      }
      orcamentoEmAlteracao = {
        numero: orcRows[0].numero,
        cliente_nome: orcRows[0].cliente_nome,
        itens: orcRows[0].itens || [],
        total: Number(orcRows[0].total),
      };
    }

    // Termos vêm pré-estruturados pelo extrator
    const termsToSearch = extractedTerms
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length > 2);

    const groupedResults = await searchProducts(termsToSearch);

    // Flat deduped list for backwards-compat use if needed
    const seen = new Set<number>();
    const searchResults: any[] = [];
    for (const g of groupedResults) {
      for (const p of g.products) {
        if (!seen.has(p.id)) { seen.add(p.id); searchResults.push(p); }
      }
    }

    console.log('[search]', { terms: termsToSearch, found: searchResults.length });

    // Build grouped stock context for the AI
    const stockContext = groupedResults.length > 0
      ? groupedResults.map(g =>
          `[${g.term}]\n${g.products.length > 0
            ? g.products.map(p => {
                const desc = String(p.descricao ?? '').trim();
                const marca = String(p.marca ?? '').trim();
                const descUpper = desc.toUpperCase();
                const marcaUpper = marca.toUpperCase();
                const marcaJaNoNome = marcaUpper && descUpper.includes(marcaUpper);
                const nomeComMarca = marca && !marcaJaNoNome ? `${desc} - ${marca}` : desc;
                const preco = p.preco_venda != null ? `R$ ${p.preco_venda}` : 'consultar';
                return `- ${nomeComMarca} - ${preco}`;
              }).join('\n')
            : '- Nenhum produto encontrado no estoque'}`
        ).join('\n\n')
      : '(Nenhum produto identificado na mensagem)';

    // Build final response
    const alteracaoBlock = orcamentoEmAlteracao ? `
MODO ALTERAÇÃO DE ORÇAMENTO — IMPORTANTE:
O vendedor pediu para ALTERAR o orçamento *${orcamentoEmAlteracao.numero}* (cliente: ${orcamentoEmAlteracao.cliente_nome || '—'}).

Itens ATUAIS do orçamento:
${orcamentoEmAlteracao.itens.map((it: any, i: number) => `${i + 1}. ${it.descricao}${it.marca ? ' - ' + it.marca : ''} — Qtd: ${it.qtd} x R$ ${Number(it.preco_unit ?? 0).toFixed(2)} = R$ ${Number(it.subtotal ?? 0).toFixed(2)}`).join('\n')}
Total atual: R$ ${orcamentoEmAlteracao.total.toFixed(2)}

REGRAS DE ALTERAÇÃO:
1. Interprete o pedido do vendedor sobre o que mudar: adicionar item, remover item, mudar quantidade, trocar produto.
2. Confirme com ele a lista FINAL de itens antes de salvar.
3. Quando ele confirmar, chame a função *alterar_orcamento* (NÃO finalizar_orcamento) passando a nova lista completa de itens, total recalculado e cliente_nome (mantenha o atual se não houver mudança).
4. NÃO crie um orçamento novo. NÃO chame finalizar_orcamento neste modo.
` : '';

    const finalPrompt = `Você é o assistente virtual da Win Distribuidora, atendendo representantes de vendas via WhatsApp.
Você é responsável por todo o processo: entender o pedido, confirmar os itens encontrados no estoque e gerar o orçamento final. NÃO há atendente humano.

REGRAS OBRIGATÓRIAS:
${config.core_prompt}

Produtos solicitados e correspondências no estoque (agrupados por item):
${stockContext}

Instruções:
1. Os produtos já estão agrupados pelo item que o vendedor solicitou. Para cada grupo, identifique qual produto do estoque é o correto.
2. Se for um novo pedido ou os itens ainda não foram confirmados, pergunte ao vendedor se os produtos encontrados são os corretos.
3. Mantenha o controle das quantidades solicitadas.
4. Após a confirmação dos itens, calcule o total e gere o orçamento completo.
5. NÃO invente produto ou preço que não esteja na lista. Se algum grupo mostrar "Nenhum produto encontrado", informe que o item não está em estoque.
6. Responda SEMPRE em português do Brasil.
7. VARIAÇÕES DE PRODUTO — MUITO IMPORTANTE: Se o vendedor perguntou sobre sabores, tamanhos ou opções de um produto (ex: "quais sabores?", "quais opções?", "tem de 1kg?", "tem creatina?"), E o estoque trouxe múltiplos produtos com o mesmo nome-base: NÃO peça confirmação do produto, LISTE TODAS as variações disponíveis como opções. REGRA ABSOLUTA: você DEVE listar TODOS os itens trazidos no grupo correspondente — NÃO resuma, NÃO selecione um subconjunto, NÃO omita nenhum. Se o grupo trouxe 12 sabores, mostre os 12. Se trouxe 3, mostre os 3. A lista é a fonte de verdade. Da mesma forma, se o vendedor pediu apenas o nome-base sem especificar sabor/tamanho e existem variações no estoque, pergunte qual variação ele deseja antes de confirmar, sempre exibindo a lista COMPLETA.

   FORMATO OBRIGATÓRIO E ÚNICO para listar variações/opções (NUNCA varie este formato, NUNCA use bullets •, NUNCA use ✅, NUNCA use negrito, NUNCA use |, NUNCA use tabela):
   Frase curta de abertura em uma linha (ex: "Temos as seguintes opções de Creatina:")
   [linha em branco]
   1. NOME DO PRODUTO - MARCA - R$ PREÇO
   2. NOME DO PRODUTO - MARCA - R$ PREÇO
   3. NOME DO PRODUTO - MARCA - R$ PREÇO
   ...
   [linha em branco]
   Pergunta final curta (ex: "Qual delas você quer?")

   Regras do formato:
   - Cada item começa com número seguido de ponto e espaço: "1. ", "2. ", "3. " ...
   - Separador entre nome, marca e preço é sempre um hífen com espaço em cada lado: " - ".
   - O preço sempre no formato "R$ 189,90" (com R$, espaço e vírgula decimal).
   - Se a marca já estiver embutida no nome (ex: "CREATINA 100% PURE 150G - ABSOLUT" e marca = "ABSOLUT"), NÃO repita a marca; mostre só "CREATINA 100% PURE 150G - ABSOLUT - R$ 19,90".
   - Não inclua emojis nos itens da lista. Não use negrito em nenhum item. Não use marcadores antes do número.
8. CONSISTÊNCIA: a lista de produtos no grupo é determinística. Se o vendedor perguntar duas vezes a mesma coisa, a resposta deve trazer EXATAMENTE os mesmos itens, na mesma ordem em que aparecem na lista do estoque. Nunca reordene, nunca filtre por critério próprio.

FORMATAÇÃO — VOCÊ ESTÁ NO WHATSAPP. SIGA ESTAS REGRAS ESTRITAMENTE:
- Negrito é UM asterisco: *texto*. NUNCA use dois asteriscos (**texto**).
- NUNCA use markdown desktop: nada de **, ---, ##, headers, blocos de código, ou linhas horizontais com tracejados.
- Para separar seções use uma linha em branco ou uma linha de em-dashes: —————————————————
- NUNCA use tabela com |.
- Itálico é _texto_, riscado é ~texto~ (use só se necessário).
- Emojis são bem-vindos no início de linhas.

Para CONFIRMAR itens, use este formato:
Identifiquei os seguintes itens no estoque:

✅ *[Nome do Produto – Marca]* × [Qtd] un.
✅ *[Nome do Produto – Marca]* × [Qtd] un.

Esses são os produtos certos? Confirme para eu gerar o orçamento! 👍

FECHAMENTO DO ORÇAMENTO — REGRA CRÍTICA:
Quando o vendedor confirmar de forma clara TODOS os itens e quantidades (ex: "ok", "isso", "pode gerar", "fechar orçamento", "manda o total"), você DEVE chamar a função "finalizar_orcamento" com a lista exata de itens, quantidades, preços unitários, subtotais e total. NÃO escreva o orçamento como texto — quem gera a mensagem final com o número do orçamento é o sistema. Você apenas chama a função.

NOME DO CLIENTE — OBRIGATÓRIO:
Todo orçamento PRECISA ter o nome do cliente. Se o vendedor ainda não informou (não apareceu no histórico da sessão), PERGUNTE antes de finalizar: "Para qual cliente é esse orçamento?". NÃO invente nome. NÃO chame "finalizar_orcamento" sem o nome do cliente em mãos. Só chame a função quando tiver: itens confirmados + nome do cliente.

${alteracaoBlock}
AMBIGUIDADE — quando perguntar:
- Se o vendedor mandar uma mensagem que pode significar "começar um pedido novo" mas você está no meio de um orçamento (ex: ele cita um produto totalmente diferente do contexto, ou diz "outro cliente", "outro pedido"), pergunte UMA vez: "Esse é um novo orçamento ou faz parte do atual?". Não pergunte isso em mensagens normais de adição de itens.
- Se você acabou de listar os itens identificados e a resposta dele for ambígua (ex: só "tá", "blz"), pergunte UMA vez: "Posso finalizar o orçamento agora ou quer adicionar mais algum item?". Não fique repetindo essa pergunta a cada mensagem.`;

    const finalResponse = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: finalPrompt },
        ...historyMessages,
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'alterar_orcamento',
            description: 'Atualiza um orçamento existente em aberto. Use APENAS quando estiver no MODO ALTERAÇÃO indicado no prompt. Substitui a lista completa de itens pelo novo conjunto fornecido.',
            parameters: {
              type: 'object',
              required: ['numero', 'cliente_nome', 'itens', 'total'],
              properties: {
                numero: {
                  type: 'string',
                  description: 'Número do orçamento a alterar (formato ORC-000123). Use o número indicado no MODO ALTERAÇÃO do prompt.',
                },
                cliente_nome: {
                  type: 'string',
                  description: 'Nome do cliente. Mantenha o nome atual se o vendedor não pediu mudança.',
                },
                itens: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['descricao', 'qtd', 'preco_unit', 'subtotal'],
                    properties: {
                      descricao: { type: 'string' },
                      marca: { type: 'string' },
                      qtd: { type: 'number' },
                      preco_unit: { type: 'number' },
                      subtotal: { type: 'number' },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'finalizar_orcamento',
            description: 'Finaliza o orçamento atual. Chamar SOMENTE depois que o vendedor confirmar de forma clara todos os itens e quantidades E tiver informado o nome do cliente.',
            parameters: {
              type: 'object',
              required: ['cliente_nome', 'itens', 'total'],
              properties: {
                cliente_nome: {
                  type: 'string',
                  description: 'Nome do cliente final. OBRIGATÓRIO. Se o vendedor ainda não informou, PERGUNTE antes de chamar esta função — NUNCA invente.',
                },
                itens: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['descricao', 'qtd', 'preco_unit', 'subtotal'],
                    properties: {
                      descricao: { type: 'string' },
                      marca: { type: 'string' },
                      qtd: { type: 'number' },
                      preco_unit: { type: 'number' },
                      subtotal: { type: 'number' },
                    },
                  },
                },
                total: { type: 'number' },
              },
            },
          },
        },
      ],
    });

    const choice = finalResponse.choices[0].message;
    const toolCall = choice.tool_calls?.find(
      (tc: any) => tc?.type === 'function' &&
        (tc?.function?.name === 'finalizar_orcamento' || tc?.function?.name === 'alterar_orcamento')
    ) as any;

    if (toolCall) {
      const fnName = toolCall.function?.name as 'finalizar_orcamento' | 'alterar_orcamento';
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (e) {
        console.error(`[${fnName}] JSON parse falhou:`, toolCall.function?.arguments);
      }

      const itens = Array.isArray(args.itens) ? args.itens : [];
      const total = Number(args.total ?? 0);
      const clienteNome = typeof args.cliente_nome === 'string' && args.cliente_nome.trim().length > 0
        ? args.cliente_nome.trim()
        : null;

      // Cliente_nome é obrigatório. Se o agente teimou e mandou sem, pergunta em vez de criar/alterar.
      if (itens.length > 0 && total > 0 && !clienteNome) {
        const askCliente = 'Antes de fechar, preciso do nome do cliente para esse orçamento. Para quem é? 👤';
        await sendWhatsAppMessage(senderNumber, askCliente);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', askCliente, 'texto']
        );
        return;
      }

      if (itens.length > 0 && total > 0 && clienteNome) {
        if (fnName === 'alterar_orcamento') {
          const numeroAlvo = orcamentoEmAlteracao?.numero
            || normalizarNumeroOrcamento(String(args.numero || ''));
          if (!numeroAlvo) {
            console.error('[alterar_orcamento] sem número alvo, ignorando');
            return;
          }
          const { rowCount } = await pool.query(
            `UPDATE orcamentos
             SET itens = $1::jsonb, total = $2, cliente_nome = $3, atualizado_em = NOW()
             WHERE numero = $4 AND vendedor_id = $5 AND status = 'aberto'`,
            [JSON.stringify(itens), total, clienteNome, numeroAlvo, vendedorId]
          );
          if ((rowCount ?? 0) === 0) {
            const reply = `Não consegui alterar o ${numeroAlvo} (já fechado ou cancelado).`;
            await sendWhatsAppMessage(senderNumber, reply);
            await pool.query(
              `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
              [currentSessionId, vendedorId, 'assistant', reply, 'texto']
            );
            return;
          }
          const replyText = formatarTextoOrcamento({
            numero: numeroAlvo,
            clienteNome,
            itens,
            total,
            cabecalho: `✏️ *ORÇAMENTO ${numeroAlvo} ATUALIZADO*`,
            rodape: `Orçamento ${numeroAlvo} atualizado e segue em aberto.`,
          });
          await sendWhatsAppMessage(senderNumber, replyText);
          await pool.query(
            `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
            [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
          );
          console.log('[alterar_orcamento]', { numero: numeroAlvo, total, itens: itens.length });
        } else {
          const { rows: seqRows } = await pool.query(`SELECT nextval('orcamento_numero_seq') AS seq`);
          const seqNum = Number(seqRows[0].seq);
          const numero = `ORC-${String(seqNum).padStart(6, '0')}`;

          await pool.query(
            `INSERT INTO orcamentos (numero, sessao_id, vendedor_id, cliente_nome, itens, total)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [numero, currentSessionId, vendedorId, clienteNome, JSON.stringify(itens), total]
          );

          await pool.query(
            `UPDATE sessoes SET status = 'orcamento_gerado', encerrada_em = NOW() WHERE id = $1`,
            [currentSessionId]
          );

          const replyText = formatarTextoOrcamento({ numero, clienteNome, itens, total });

          await sendWhatsAppMessage(senderNumber, replyText);
          await pool.query(
            `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
            [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
          );
          console.log('[orcamento]', { numero, total, itens: itens.length });
        }
      } else {
        console.error(`[${fnName}] args inválidos, ignorando:`, args);
      }
    } else {
      const replyText = choice.content;
      if (replyText) {
        await sendWhatsAppMessage(senderNumber, replyText);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
        );
      }
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
