// Backfill ÚNICO do enriquecimento do catálogo:
//   - limpa o mojibake das descrições (UTF-8 lido como Windows-1252)
//   - deriva marca / nome-base / variação / grupo-chave de cada produto
//   - classifica a categoria (só onde ainda está vazia — nunca sobrescreve curadoria)
//
// Idempotente: pode rodar quantas vezes precisar. As mesmas funções rodam a cada
// upload de estoque (api/routes/products.ts), então isto é só pra popular a base
// atual de uma vez.
//
// Uso: npx tsx --env-file=.env scripts/backfill-catalogo.ts
//
// ⚠️ ALTERA DADOS EM PRODUÇÃO. Rode com ciência (política CLAUDE.md #3).

import 'dotenv/config';
import { Pool } from 'pg';
import { reenriquecerProdutos } from '../api/services/loja.js';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('Defina DATABASE_URL no ambiente (ex: copie de .env).');
  process.exit(1);
}

const pool = new Pool({ connectionString: CONN.split('?')[0], ssl: { rejectUnauthorized: false }, max: 3 });

async function main() {
  const c = await pool.connect();
  try {
    // Garante as colunas/índices (mesmos da migration de boot) — idempotente.
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS marca VARCHAR(255);`);
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS categoria VARCHAR(255);`);
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS nome_base TEXT;`);
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variacao TEXT;`);
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS variacao_tipo TEXT;`);
    await c.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS grupo_chave TEXT;`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_products_grupo_chave ON products(grupo_chave);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_products_categoria ON products(categoria) WHERE ativo;`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_products_marca ON products(lower(marca)) WHERE ativo;`);

    // --reclassificar força a categoria (sobrescreve) — use só quando ainda não há
    // curadoria manual (ex.: backfill inicial / correção da classificação).
    const forcarCategoria = process.argv.includes('--reclassificar');
    console.log(`Enriquecendo produtos${forcarCategoria ? ' (reclassificando categorias)' : ''}...`);
    const r = await reenriquecerProdutos(c, { forcarCategoria });
    console.log(`OK. ${r.total} produtos | ${r.descricoesLimpas} descrições limpas | ${r.categorizados} categorizados (vazios)`);

    const { rows } = await c.query(`
      SELECT coalesce(categoria, '(sem)') categoria, count(DISTINCT grupo_chave)::int grupos, count(*)::int skus
      FROM products WHERE ativo GROUP BY categoria ORDER BY grupos DESC`);
    console.log('\nDistribuição (grupos / SKUs por categoria):');
    for (const row of rows) console.log(`  ${String(row.categoria).padEnd(20)} ${String(row.grupos).padStart(5)} grupos  ${String(row.skus).padStart(5)} skus`);
  } catch (e) {
    console.error('Erro:', e);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main();
