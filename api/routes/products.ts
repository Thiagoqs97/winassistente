import { Router } from 'express';
import * as xlsx from 'xlsx';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { reenriquecerProdutos } from '../services/loja.js';
import { categoriaValida, CATEGORIAS } from '../services/catalogo-enrich.js';

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

    // Resolve a CHAVE original da coluna que casa (exata primeiro, depois parcial).
    // excludeKeys permite "reservar" uma coluna já consumida por outro campo —
    // ex.: a coluna de código de barras não pode reaparecer como preço.
    const findKey = (row: Record<string, any>, exactKeys: string[], partialKeys: string[], excludeKeys: string[] = []): string | null => {
      const keys = Object.keys(row)
        .filter(k => !excludeKeys.includes(k))
        .map(k => ({ original: k, lower: k.trim().toLowerCase() }));
      const exact = keys.find(({ lower }) => exactKeys.some(ek => lower === ek.toLowerCase()));
      if (exact) return exact.original;
      const partial = keys.find(({ lower }) => partialKeys.some(pk => lower.includes(pk.toLowerCase())));
      return partial ? partial.original : null;
    };

    const getVal = (row: Record<string, any>, exactKeys: string[], partialKeys: string[], excludeKeys: string[] = []) => {
      const key = findKey(row, exactKeys, partialKeys, excludeKeys);
      return key ? row[key] : null;
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
      // Resolvido ANTES do preço: na planilha WINTHOR o cabeçalho do código de
      // barras é "Unidade Venda [EAN8, UPC12, EAN13, e DUN14]" e contém a palavra
      // "venda". Sem reservar essa coluna, o matcher de preço (que casa "venda"
      // parcialmente) gravaria o EAN como preço de venda.
      const codigoBarrasKey = findKey(row,
        [
          'gtin unid.venda', 'gtin unid. venda', 'gtin',
          'unidade venda [ean8, upc12, ean13, e dun14]',
          'ean unid. tributável', 'ean unid.tributável',
          'codigo de barras', 'código de barras', 'ean',
        ],
        ['gtin', 'ean', 'barras', 'codigo_barras']
      );
      const codigoBarras = codigoBarrasKey ? row[codigoBarrasKey] : null;

      const precoRaw = getVal(row,
        [
          'tipo integração b2b venda', 'tipo integracao b2b venda',
          'sugerir preço de venda baseado', 'sugerir preco de venda baseado',
          'preço de venda', 'preco de venda', 'preço venda', 'preco venda',
          'venda', 'preço', 'preco', 'valor', 'price',
        ],
        ['tipo integraç', 'tipo integrac', 'sugerir preç', 'sugerir prec', 'preço', 'preco', 'valor', 'venda'],
        codigoBarrasKey ? [codigoBarrasKey] : []
      );
      const embalagem = getVal(row, ['embalagem', 'emb'], ['embalagem']);
      const categoria = getVal(row,
        ['nome da categoria', 'categoria', 'nome categoria'],
        ['categ']
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
      // Preserva a curadoria do painel (tags E categoria): o DELETE abaixo recria
      // todos os produtos, então salvamos por código e reaplicamos após o insert.
      // marca/nome_base/variacao/grupo_chave NÃO precisam ser preservados — são
      // derivados da descrição e recalculados pelo reenriquecerProdutos no fim.
      await client.query(`
        CREATE TEMP TABLE _saved_enrich ON COMMIT DROP AS
        SELECT codigo, tags, categoria FROM products
        WHERE (tags IS NOT NULL AND tags <> '') OR (categoria IS NOT NULL AND categoria <> '')
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
        UPDATE products p SET tags = s.tags, categoria = COALESCE(s.categoria, p.categoria)
        FROM _saved_enrich s WHERE p.codigo = s.codigo
      `);

      // Limpa o mojibake das descrições e (re)deriva marca/nome-base/variação/
      // grupo-chave + classifica a categoria dos produtos novos (sem categoria).
      // A curadoria reaplicada acima é preservada (COALESCE no SQL do enrich).
      await reenriquecerProdutos(client);

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

// Taxonomia de categorias do catálogo (para popular o seletor no painel).
productsRouter.get('/products/categorias-taxonomia', requirePermission('products.view'), (_req, res) => {
  res.json(CATEGORIAS);
});

// Reclassifica a categoria de um GRUPO inteiro (todos os SKUs/sabores do mesmo
// produto). Ancorado em grupo_chave porque a categoria é uma propriedade do
// produto, não do sabor — corrigir um card corrige todas as variações de uma vez.
productsRouter.patch('/products/categoria', requirePermission('products.edit'), async (req, res) => {
  try {
    const { grupoChave, categoria } = req.body ?? {};
    if (!grupoChave || typeof grupoChave !== 'string') return res.status(400).json({ error: 'grupoChave obrigatório' });
    if (!categoriaValida(categoria)) return res.status(400).json({ error: 'Categoria inválida' });
    const { rows } = await pool.query(
      'UPDATE products SET categoria = $1 WHERE grupo_chave = $2 RETURNING id',
      [categoria, grupoChave]
    );
    res.json({ categoria, atualizados: rows.length, ids: rows.map((r) => r.id) });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Edita as tags/palavras-chave de busca e/ou a categoria de um produto (curadoria
// manual no painel). Aceita qualquer subconjunto de { tags, categoria }.
productsRouter.patch('/products/:id', requirePermission('products.edit'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];
    if ('tags' in body) {
      params.push(body.tags == null || String(body.tags).trim() === '' ? null : String(body.tags).trim());
      sets.push(`tags = $${params.length}`);
    }
    if ('categoria' in body) {
      if (!categoriaValida(body.categoria)) return res.status(400).json({ error: 'Categoria inválida' });
      params.push(body.categoria);
      sets.push(`categoria = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
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
