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
        status TEXT DEFAULT 'finalizado' CHECK (status IN ('finalizado', 'cancelado')),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor ON orcamentos(vendedor_id, criado_em DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_numero ON orcamentos(numero);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(lower(cliente_nome));`);

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
      `UPDATE orcamentos SET status = 'cancelado' WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

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
      `INSERT INTO vendedores (numero_whatsapp) VALUES ($1) ON CONFLICT (numero_whatsapp) DO UPDATE SET ativo = true RETURNING id`,
      [senderNumber]
    );
    const vendedorId = vendRows[0].id;

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
          content: `Você NÃO é um chatbot. Você é um EXTRATOR DE TERMOS DE BUSCA. Você NUNCA responde, NUNCA explica, NUNCA se desculpa, NUNCA diz "não localizei". Sua ÚNICA saída é um JSON com a estrutura abaixo.

SAÍDA (JSON obrigatório, sem texto extra):
{
  "new_session": boolean,   // true SOMENTE se o vendedor pediu novo pedido / outro cliente explicitamente
  "terms": string[]         // termos de busca a usar contra o estoque, em minúsculas
}

REGRAS PARA "terms":
1. Use APENAS o nome-base do produto. NÃO invente nem acrescente sabor, gramatura, marca ou variação que o vendedor não tenha dito explicitamente.
   - "Qual o valor da creatina dux de 300g" → ["creatina dux 300g"]      (vendedor disse 300g, mantém)
   - "Qual o valor da creatina dux" → ["creatina dux"]                    (sem gramatura, NÃO invente)
   - "CREATINA DUX" → ["creatina dux"]                                    (NÃO acrescente "300g")
   - "Quais os sabores do TASTY WHEY?" → ["tasty whey"]                   (pergunta variações → só nome-base)
   - "Quais sabores tem o whey gold?" → ["whey gold"]                     (idem)
   - "Tem outro tamanho da creatina dux?" → ["creatina dux"]              (idem)
2. Se o vendedor citou MÚLTIPLOS produtos / sabores específicos, liste todos.
   - "Me faz orçamento com 2 tasty whey chocolate e 1 morango" → ["tasty whey chocolate","tasty whey morango"]
3. Considere a CONVERSA INTEIRA. Para confirmações ("sim","ok","isso") OU perguntas de detalhe ("qual sabor?","quanto custa?","tem mais?","quais opções","quais sabores","tem maior?","tem menor?") — retorne os mesmos termos do último pedido do vendedor, sem alterar sabor/gramatura.
4. Para planilhas/CSV: extraia TODOS os nomes de produtos, um por item; ignore colunas de quantidade/código/preço.
5. Para saudações, agradecimentos, mensagens sem produto → "terms": [].
6. NUNCA escreva frases. NUNCA inclua texto fora do JSON.

EXEMPLOS:
- "Quais os sabores do TASTY WHEY?" → {"new_session":false,"terms":["tasty whey"]}
- "Qual o valor da creatina dux de 300g" → {"new_session":false,"terms":["creatina dux 300g"]}
- "tem maior?" (após pedir creatina dux) → {"new_session":false,"terms":["creatina dux"]}
- "esquece, novo pedido pra outro cliente" → {"new_session":true,"terms":[]}
- "Bom dia" → {"new_session":false,"terms":[]}
- "obrigado" → {"new_session":false,"terms":[]}
- "Pedido recebido em planilha:\\nProduto | Qtd\\nCreatina DUX 300g | 2\\nWhey Gold 1kg | 5" → {"new_session":false,"terms":["creatina dux 300g","whey gold 1kg"]}`,
        },
        ...historyMessages,
        { role: 'user', content: incomingText },
      ],
    });

    const rawExtract = extractResponse.choices[0].message.content || '{}';
    let parsedExtract: { new_session?: boolean; terms?: string[] } = {};
    try {
      parsedExtract = JSON.parse(rawExtract);
    } catch {
      console.error('[extract] JSON parse failed, raw:', rawExtract);
    }
    const newSession = parsedExtract.new_session === true;
    const extractedTerms = Array.isArray(parsedExtract.terms) ? parsedExtract.terms : [];
    console.log('[extract]', { incomingText, newSession, extractedTerms });

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
            name: 'finalizar_orcamento',
            description: 'Finaliza o orçamento atual. Chamar SOMENTE depois que o vendedor confirmar de forma clara todos os itens e quantidades.',
            parameters: {
              type: 'object',
              required: ['itens', 'total'],
              properties: {
                cliente_nome: {
                  type: 'string',
                  description: 'Nome do cliente final, apenas se o vendedor mencionou. Caso contrário omita.',
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
      (tc: any) => tc?.type === 'function' && tc?.function?.name === 'finalizar_orcamento'
    ) as any;

    if (toolCall) {
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (e) {
        console.error('[finalizar_orcamento] JSON parse falhou:', toolCall.function?.arguments);
      }

      const itens = Array.isArray(args.itens) ? args.itens : [];
      const total = Number(args.total ?? 0);
      const clienteNome = typeof args.cliente_nome === 'string' && args.cliente_nome.trim().length > 0
        ? args.cliente_nome.trim()
        : null;

      if (itens.length > 0 && total > 0) {
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

        const fmtBR = (n: number) => n.toFixed(2).replace('.', ',');
        const linhas = itens.map((it: any, i: number) => {
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

        const replyText = `📋 *ORÇAMENTO ${numero}*
—————————————————${clienteNome ? `\nCliente: ${clienteNome}` : ''}

${linhas}
—————————————————
💰 *TOTAL: R$ ${fmtBR(total)}*
—————————————————

Orçamento ${numero} salvo. Para um novo atendimento, é só enviar uma nova mensagem.`;

        await sendWhatsAppMessage(senderNumber, replyText);
        await pool.query(
          `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
          [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
        );
        console.log('[orcamento]', { numero, total, itens: itens.length });
      } else {
        console.error('[finalizar_orcamento] args inválidos, ignorando:', args);
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
