import { pool } from '../db/pool.js';

// Alerta de mudança de preço (Fase 4 — 5.5).
// Busca o ÚLTIMO preço unitário cotado por um vendedor para cada produto identificado,
// olhando dentro de orçamentos dele nos últimos N dias (default 90).
// A chave do mapa é `lower(descricao)`. Marca embutida no nome conta como diferença
// — se o vendedor cotou um produto com nome diferente, não bate (consciente).

export interface UltimoPrecoVendedor {
  descricao: string;
  marca: string | null;
  ultimo_preco_unit: number;
  orcamento_numero: string;
  criado_em: Date;
}

const LOOKBACK_DIAS = 90;

export async function getUltimosPrecosVendedor(
  vendedorId: string,
  descricoes: string[],
): Promise<Map<string, UltimoPrecoVendedor>> {
  const out = new Map<string, UltimoPrecoVendedor>();
  if (!vendedorId || descricoes.length === 0) return out;

  const descricoesNorm = Array.from(new Set(
    descricoes.map(d => String(d || '').trim().toLowerCase()).filter(Boolean)
  ));
  if (descricoesNorm.length === 0) return out;

  const desde = new Date(Date.now() - LOOKBACK_DIAS * 24 * 60 * 60 * 1000);

  // Para cada descrição, pega o último preço cotado num orçamento desse vendedor.
  // DISTINCT ON garante 1 linha por descrição (a mais recente).
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (lower(item->>'descricao'))
       lower(item->>'descricao')              AS d_low,
       item->>'descricao'                     AS descricao,
       item->>'marca'                         AS marca,
       (item->>'preco_unit')::numeric         AS preco_unit,
       o.numero                               AS orcamento_numero,
       o.criado_em                            AS criado_em
     FROM orcamentos o,
          LATERAL jsonb_array_elements(o.itens) AS item
     WHERE o.vendedor_id = $1
       AND o.criado_em >= $2
       AND lower(item->>'descricao') = ANY($3::text[])
     ORDER BY lower(item->>'descricao'), o.criado_em DESC`,
    [vendedorId, desde, descricoesNorm]
  );

  for (const r of rows) {
    out.set(r.d_low, {
      descricao: r.descricao,
      marca: r.marca || null,
      ultimo_preco_unit: Number(r.preco_unit) || 0,
      orcamento_numero: r.orcamento_numero,
      criado_em: r.criado_em,
    });
  }
  return out;
}

// Compara preço atual com o último cotado. Tolerância de 1% para não alertar
// por arredondamento. Retorna "subiu", "caiu" ou null (sem mudança relevante).
export interface VariacaoPreco {
  direcao: 'subiu' | 'caiu';
  delta_brl: number;       // valor absoluto da diferença (sempre positivo)
  delta_pct: number;       // percentual absoluto (0..1)
  preco_anterior: number;
  preco_atual: number;
  orcamento_anterior: string;
}

const TOLERANCIA_PCT = 0.01;

export function compararPreco(
  precoAtual: number,
  ultimo: UltimoPrecoVendedor | undefined,
): VariacaoPreco | null {
  if (!ultimo || !(ultimo.ultimo_preco_unit > 0) || !(precoAtual > 0)) return null;
  const delta = precoAtual - ultimo.ultimo_preco_unit;
  const pct = Math.abs(delta) / ultimo.ultimo_preco_unit;
  if (pct < TOLERANCIA_PCT) return null;
  return {
    direcao: delta > 0 ? 'subiu' : 'caiu',
    delta_brl: Math.abs(delta),
    delta_pct: pct,
    preco_anterior: ultimo.ultimo_preco_unit,
    preco_atual: precoAtual,
    orcamento_anterior: ultimo.orcamento_numero,
  };
}
