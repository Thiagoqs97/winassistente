import { Router } from 'express';
import * as xlsx from 'xlsx';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const productsRouter = Router();

productsRouter.use(requireAuth);

// Upload de estoque (xlsx em base64). Vercel serverless não aceita multipart estável,
// então o cliente envia base64 via JSON.
productsRouter.post('/upload-stock', requirePermission('products.import'), async (req, res) => {
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

    logger.info('Importação iniciada', { colunas: Object.keys(rawData[0]) });

    const getVal = (row: Record<string, any>, exactKeys: string[], partialKeys: string[]) => {
      const keys = Object.keys(row).map(k => ({ original: k, lower: k.trim().toLowerCase() }));
      const exact = keys.find(({ lower }) => exactKeys.some(ek => lower === ek.toLowerCase()));
      if (exact) return row[exact.original];
      const partial = keys.find(({ lower }) => partialKeys.some(pk => lower.includes(pk.toLowerCase())));
      return partial ? row[partial.original] : null;
    };

    // Parser de preço BR (R$ 1.234,50 → 1234.50)
    const parsePreco = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number') return isFinite(val) ? val : null;
      const cleaned = String(val)
        .replace(/R\$\s*/gi, '')
        .trim()
        .replace(/\./g, '')
        .replace(',', '.')
        .replace(/[^0-9.-]/g, '');
      const n = parseFloat(cleaned);
      return isFinite(n) && n > 0 ? n : null;
    };

    // Resolve marca textual quando vier também como ID numérico
    const getMarca = (row: Record<string, any>): string | null => {
      const keys = Object.keys(row);
      const marcaKeys = keys.filter(k => k.trim().toLowerCase().includes('marca'));
      for (const k of marcaKeys) {
        const v = row[k];
        if (v && isNaN(Number(v))) return String(v).trim();
      }
      if (marcaKeys.length > 0) {
        const v = row[marcaKeys[0]];
        return v ? String(v).trim() : null;
      }
      return null;
    };

    let inserted = 0;
    let skipped = 0;
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

    // Chunking — grava em lotes de 500 para evitar estouro de memória/timeout
    const CHUNK = 500;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Preserva as tags curadas no painel: o DELETE abaixo recria todos os produtos,
      // então salvamos as tags por código e reaplicamos após o insert.
      await client.query(`
        CREATE TEMP TABLE _saved_tags ON COMMIT DROP AS
        SELECT codigo, tags FROM products WHERE tags IS NOT NULL AND tags <> ''
      `);
      await client.query('DELETE FROM products');

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const placeholders = chunk.map((_row, ci) => {
          const b = ci * 7;
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
        });
        const vals: any[] = chunk.flat();
        await client.query(`
          INSERT INTO products (codigo, descricao, preco_venda, marca, embalagem, categoria, codigo_barras)
          VALUES ${placeholders.join(',')}
          ON CONFLICT (codigo) DO UPDATE
          SET descricao=EXCLUDED.descricao, preco_venda=EXCLUDED.preco_venda,
              marca=EXCLUDED.marca, embalagem=EXCLUDED.embalagem,
              categoria=EXCLUDED.categoria, codigo_barras=EXCLUDED.codigo_barras,
              ativo=true
        `, vals);
        inserted += chunk.length;
      }

      await client.query(`
        UPDATE products p SET tags = s.tags
        FROM _saved_tags s WHERE p.codigo = s.codigo
      `);

      await client.query('COMMIT');
      res.json({ message: `${inserted} produtos importados com sucesso.${skipped > 0 ? ` (${skipped} linhas ignoradas)` : ''}` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    logger.error('Import error', { err: err?.message });
    res.status(500).json({ error: err.message || 'Erro ao processar planilha' });
  }
});

productsRouter.get('/products', requirePermission('products.view'), async (_req, res) => {
  try {
    // Sem LIMIT — o painel filtra client-side e precisa ver todo o estoque.
    // Pra bases muito grandes (>50k), futura paginação server-side resolve.
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Edita as tags/palavras-chave de busca de um produto (curadoria manual no painel).
productsRouter.patch('/products/:id', requirePermission('products.edit'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
    const { tags } = req.body ?? {};
    const val = tags == null || String(tags).trim() === '' ? null : String(tags).trim();
    const { rows } = await pool.query(
      'UPDATE products SET tags = $1 WHERE id = $2 RETURNING *',
      [val, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

productsRouter.put('/products/:id/toggle', requirePermission('products.edit'), async (req, res) => {
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
