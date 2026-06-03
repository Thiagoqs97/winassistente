import { pool } from '../db/pool.js';

// Limite alto por termo: quando o vendedor pergunta "quais sabores do X", precisamos
// retornar TODAS as variações; 30 cobre listas grandes sem estourar o prompt.
const MAX_PER_TERM = 30;

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

// strong: palavras com peso alto, exigidas (AND)
// weak: números/unidades, peso baixo, apenas bônus
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

export async function searchProducts(terms: string[]): Promise<{ term: string; products: any[] }[]> {
  if (terms.length === 0) return [];

  const byTerm = new Map<string, Map<number, any>>(terms.map(t => [t, new Map()]));

  // Strategy 1+2 (batched): trigram similarity + substring ILIKE no termo inteiro.
  // ORDER BY sml DESC, p.id ASC garante ordem determinística entre queries iguais.
  const { rows: batchRows } = await pool.query(`
    WITH term_list AS (SELECT UNNEST($1::text[]) AS term),
    matches AS (
      SELECT
        p.id, p.codigo, p.descricao, p.preco_venda, p.marca, p.embalagem,
        t.term,
        GREATEST(
          similarity(unaccent(lower(p.descricao)), unaccent(lower(t.term))),
          similarity(unaccent(lower(coalesce(p.tags, ''))), unaccent(lower(t.term))),
          CASE WHEN unaccent(lower(p.descricao)) ILIKE '%' || unaccent(lower(t.term)) || '%'
               THEN 0.5 ELSE 0 END,
          CASE WHEN p.tags IS NOT NULL AND unaccent(lower(p.tags)) ILIKE '%' || unaccent(lower(t.term)) || '%'
               THEN 0.5 ELSE 0 END
        ) AS sml
      FROM products p
      CROSS JOIN term_list t
      WHERE p.ativo = true
        AND (
          similarity(unaccent(lower(p.descricao)), unaccent(lower(t.term))) > 0.08
          OR unaccent(lower(p.descricao)) ILIKE '%' || unaccent(lower(t.term)) || '%'
          OR similarity(unaccent(lower(coalesce(p.tags, ''))), unaccent(lower(t.term))) > 0.08
          OR (p.tags IS NOT NULL AND unaccent(lower(p.tags)) ILIKE '%' || unaccent(lower(t.term)) || '%')
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

  // Strategy 3: keyword-based ILIKE — sempre roda para termos multi-palavra.
  // AND nas palavras-fortes + bônus por palavras-fracas (números/unidades).
  // Permite encontrar "Creatina Dux 300 gramas" a partir de "creatina dux 300g".
  for (const term of terms) {
    const m = byTerm.get(term)!;
    const { strong, weak } = extractKeywords(normalizeTerm(term));

    if (strong.length === 0) continue;

    // Haystack inclui as tags curadas: "omega 3" casa um produto descrito só como "ômega"
    // se tiver a tag correspondente.
    const haystack = `unaccent(lower(descricao || ' ' || coalesce(tags, '')))`;

    const strongConds = strong
      .map((_, i) => `${haystack} ILIKE '%' || unaccent(lower($${i + 1})) || '%'`)
      .join(' AND ');

    const weakBonusExpr = weak.length > 0
      ? weak.map((_, i) =>
          `(CASE WHEN ${haystack} ILIKE '%' || unaccent(lower($${strong.length + i + 1})) || '%' THEN 0.1 ELSE 0 END)`
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

function onlyDigits(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

// Detecta um possível CPF/CNPJ no termo (11 ou 14 dígitos, ou prefixo razoável)
function extractDocDigits(term: string): string | null {
  const d = onlyDigits(term);
  if (d.length >= 11) return d;
  return null;
}

export type ClienteMatch = {
  id: string;
  nome: string;
  fantasia: string | null;
  cpf_cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  fone: string | null;
  celular: string | null;
  externo_id: string | null;
  score: number;
  match_type: 'exato' | 'documento' | 'externo_id' | 'telefone' | 'fuzzy';
};

export async function searchClientes(query: string, limit = 8): Promise<ClienteMatch[]> {
  const q = (query || '').trim();
  if (!q) return [];

  // 1) match exato por externo_id (números longos do Tiny/Bling)
  const allDigits = onlyDigits(q);
  if (allDigits.length >= 8) {
    const { rows } = await pool.query(
      `SELECT id, nome, fantasia, cpf_cnpj, cidade, uf, fone, celular, externo_id
       FROM clientes WHERE externo_id = $1 LIMIT 1`,
      [allDigits]
    );
    if (rows.length > 0) {
      return rows.map(r => ({ ...r, score: 1, match_type: 'externo_id' as const }));
    }
  }

  // 2) match exato por CPF/CNPJ (qualquer formatação)
  const docDigits = extractDocDigits(q);
  if (docDigits) {
    const { rows } = await pool.query(
      `SELECT id, nome, fantasia, cpf_cnpj, cidade, uf, fone, celular, externo_id
       FROM clientes WHERE regexp_replace(coalesce(cpf_cnpj, ''), '\\D', '', 'g') = $1
       LIMIT 5`,
      [docDigits]
    );
    if (rows.length > 0) {
      return rows.map(r => ({ ...r, score: 1, match_type: 'documento' as const }));
    }
  }

  // 3) match por telefone (8 a 13 dígitos)
  if (allDigits.length >= 8 && allDigits.length < 14) {
    const { rows } = await pool.query(
      `SELECT id, nome, fantasia, cpf_cnpj, cidade, uf, fone, celular, externo_id
       FROM clientes
       WHERE regexp_replace(coalesce(fone, '') || coalesce(celular, ''), '\\D', '', 'g') LIKE '%' || $1 || '%'
       LIMIT 5`,
      [allDigits]
    );
    if (rows.length > 0) {
      return rows.map(r => ({ ...r, score: 0.95, match_type: 'telefone' as const }));
    }
  }

  // 4) Fuzzy por nome / fantasia (trigram + ILIKE)
  const { rows } = await pool.query(
    `WITH base AS (
       SELECT id, nome, fantasia, cpf_cnpj, cidade, uf, fone, celular, externo_id,
              GREATEST(
                similarity(unaccent(lower(nome)), unaccent(lower($1))),
                similarity(unaccent(lower(coalesce(fantasia, ''))), unaccent(lower($1))),
                CASE WHEN unaccent(lower(nome)) ILIKE '%' || unaccent(lower($1)) || '%' THEN 0.55 ELSE 0 END,
                CASE WHEN unaccent(lower(coalesce(fantasia, ''))) ILIKE '%' || unaccent(lower($1)) || '%' THEN 0.55 ELSE 0 END
              ) AS sml
       FROM clientes
       WHERE ativo = true
     )
     SELECT * FROM base
     WHERE sml > 0.18
     ORDER BY sml DESC, nome ASC
     LIMIT $2`,
    [q, limit]
  );

  if (rows.length === 0) {
    const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (tokens.length > 0) {
      const conds = tokens
        .map((_, i) => `unaccent(lower(nome || ' ' || coalesce(fantasia, ''))) ILIKE '%' || unaccent(lower($${i + 1})) || '%'`)
        .join(' AND ');
      const { rows: kw } = await pool.query(
        `SELECT id, nome, fantasia, cpf_cnpj, cidade, uf, fone, celular, externo_id, 0.4 AS sml
         FROM clientes
         WHERE ativo = true AND (${conds})
         ORDER BY nome ASC LIMIT $${tokens.length + 1}`,
        [...tokens, limit]
      );
      return kw.map(r => ({ ...r, score: Number(r.sml), match_type: 'fuzzy' as const }));
    }
  }

  return rows.map(r => ({ ...r, score: Number(r.sml), match_type: 'fuzzy' as const }));
}

// Helpers exportados para uso em testes/scripts
export const __internals = { normalizeTerm, extractKeywords, STOP_WORDS };
