import { pool } from '../db/pool.js';
import { iterateProdutos } from './bling.js';

// Normalização p/ casamento: tira acento, minúsculo, colapsa não-alfanumérico.
// Estrito de propósito (começamos só com match seguro; afrouxamos depois).
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos (NFD os separa em marcas)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface OurProduct {
  id: number;
  codigo: string | null;
  descricao: string;
}

export interface DiagnosticoResult {
  ourTotal: number;
  blingTotal: number;
  matchedBySku: number;
  matchedByName: number;
  matchedTotal: number;
  faltantes: Array<{ id: number; codigo: string | null; descricao: string }>;
}

function pushTo(map: Map<string, OurProduct[]>, key: string, p: OurProduct): void {
  const arr = map.get(key);
  if (arr) arr.push(p);
  else map.set(key, [p]);
}

// Dry-run: mede quantos dos NOSSOS produtos casam com o Bling por SKU exato
// ou nome exato (e únicos). Não baixa imagem nenhuma. Devolve a lista dos que
// ficaram sem match seguro (os "faltantes").
export async function diagnosticoBling(): Promise<DiagnosticoResult> {
  const { rows: ours } = await pool.query<OurProduct>(
    'SELECT id, codigo, descricao FROM products WHERE ativo = true',
  );

  const bySku = new Map<string, OurProduct[]>();
  const byName = new Map<string, OurProduct[]>();
  for (const p of ours) {
    const sku = norm(p.codigo);
    if (sku) pushTo(bySku, sku, p);
    const name = norm(p.descricao);
    if (name) pushTo(byName, name, p);
  }

  const matchedIds = new Set<number>();
  let matchedBySku = 0;
  let matchedByName = 0;
  let blingTotal = 0;

  for await (const bp of iterateProdutos()) {
    blingTotal++;

    // 1) SKU idêntico e único do nosso lado → match seguro.
    const sku = norm(bp.codigo);
    const skuCands = sku ? bySku.get(sku) : undefined;
    if (skuCands && skuCands.length === 1 && !matchedIds.has(skuCands[0].id)) {
      matchedIds.add(skuCands[0].id);
      matchedBySku++;
      continue;
    }

    // 2) Nome normalizado idêntico e único → match seguro.
    const name = norm(bp.nome);
    const nameCands = name ? byName.get(name) : undefined;
    if (nameCands && nameCands.length === 1 && !matchedIds.has(nameCands[0].id)) {
      matchedIds.add(nameCands[0].id);
      matchedByName++;
      continue;
    }
  }

  const faltantes = ours
    .filter((p) => !matchedIds.has(p.id))
    .map((p) => ({ id: p.id, codigo: p.codigo, descricao: p.descricao }));

  return {
    ourTotal: ours.length,
    blingTotal,
    matchedBySku,
    matchedByName,
    matchedTotal: matchedIds.size,
    faltantes,
  };
}
