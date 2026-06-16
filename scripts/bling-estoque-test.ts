/**
 * Validação do scope de ESTOQUE do Bling (GET /estoques/saldos), SEM gravar nada.
 *
 * Pega alguns produtos já mapeados (bling_id != null) da base e busca o saldo em
 * lote. Prova que o app do Bling tem permissão de Estoques (sem 403) e mostra os
 * saldos reais antes de rodar o sync que grava em products.estoque_saldo.
 *
 * Rodar:  npx tsx scripts/bling-estoque-test.ts
 */
import 'dotenv/config';
import { pool } from '../api/db/pool.js';
import { getConnectionStatus, getSaldosEstoque } from '../api/services/bling.js';

async function main(): Promise<void> {
  const conn = await getConnectionStatus();
  console.log('Conexão Bling:', conn);
  if (!conn.connected) {
    console.error('\n❌ Bling não conectado. Reconecte pelo painel (Configurações → Bling) e rode de novo.');
    process.exit(1);
  }

  const { rows } = await pool.query<{ id: number; descricao: string; bling_id: number }>(
    `SELECT id, descricao, bling_id FROM products
      WHERE ativo = true AND bling_id IS NOT NULL
      ORDER BY id LIMIT 8`,
  );
  if (rows.length === 0) {
    console.error('\n❌ Nenhum produto com bling_id. Rode o /bling/mapear antes.');
    process.exit(1);
  }

  const ids = rows.map((r) => r.bling_id);
  console.log(`\n→ Buscando saldo de ${ids.length} produtos: ${ids.join(', ')}\n`);

  try {
    const saldos = await getSaldosEstoque(ids);
    const porId = new Map(saldos.map((s) => [s.produtoId, s]));
    for (const r of rows) {
      const s = porId.get(r.bling_id);
      const txt = s
        ? `virtual=${s.saldoVirtual ?? '—'}  físico=${s.saldoFisico ?? '—'}`
        : '(Bling não retornou)';
      console.log(`  [${r.bling_id}] ${r.descricao.slice(0, 50).padEnd(50)} → ${txt}`);
    }
    console.log(`\n✅ Scope de estoque OK. ${saldos.length}/${ids.length} produtos retornaram saldo.`);
  } catch (e: any) {
    const status = e?.response?.status;
    console.error('\n❌ Falhou ao buscar saldo.');
    if (status === 403) {
      console.error(
        'HTTP 403 — o app do Bling NÃO tem permissão de "Estoques". ' +
          'Habilite o escopo Estoques no cadastro do app no Bling e reconecte pelo painel.',
      );
    } else {
      console.error(`HTTP ${status ?? '?'} —`, JSON.stringify(e?.response?.data ?? e?.message)?.slice(0, 600));
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
