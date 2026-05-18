// Agregadores do dashboard (Fase 2). Cada função recebe um `range` resolvido
// e um `vendedorFilter` (sub-login com vendedor_id vê só o próprio).
// Queries são intencionalmente simples e usam os índices existentes
// — sem N+1 mesmo nos rankings (tudo em um SELECT agregado).

import { pool } from '../db/pool.js';

export interface DashboardRange {
  de: Date;  // inclusivo
  ate: Date; // exclusivo (right-open) — facilita "este mês" = primeiro dia do mês até primeiro dia do próximo
}

export interface VendedorScope {
  vendedorId: string | null; // null = sem filtro (admin / sub sem vínculo)
}

// Helpers ------------------------------------------------------------

function vendedorClause(col: string, scope: VendedorScope, nextParamIdx: number): { sql: string; param?: string } {
  if (!scope.vendedorId) return { sql: '' };
  return { sql: ` AND ${col} = $${nextParamIdx}`, param: scope.vendedorId };
}

// KPIs ---------------------------------------------------------------

export interface KpisResult {
  faturamento_brl: number;
  ticket_medio_brl: number;
  conversao: number;          // 0..1 (vendas / total no período)
  num_orcamentos: number;     // total no período (qualquer status)
  num_vendas: number;
  num_abertos: number;
  num_cancelados: number;
}

export async function getKpis(range: DashboardRange, scope: VendedorScope): Promise<KpisResult> {
  const params: any[] = [range.de, range.ate];
  const vf = vendedorClause('vendedor_id', scope, 3);
  if (vf.param) params.push(vf.param);

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'venda')::int     AS num_vendas,
       COUNT(*) FILTER (WHERE status = 'aberto')::int    AS num_abertos,
       COUNT(*) FILTER (WHERE status = 'cancelado')::int AS num_cancelados,
       COUNT(*)::int                                     AS num_orcamentos,
       COALESCE(SUM(total) FILTER (WHERE status = 'venda'), 0)::float AS faturamento_brl
     FROM orcamentos
     WHERE criado_em >= $1 AND criado_em < $2${vf.sql}`,
    params
  );

  const r = rows[0];
  const numVendas = r.num_vendas;
  const numTotal = r.num_orcamentos;
  const fat = Number(r.faturamento_brl);
  return {
    faturamento_brl: fat,
    ticket_medio_brl: numVendas > 0 ? fat / numVendas : 0,
    conversao: numTotal > 0 ? numVendas / numTotal : 0,
    num_orcamentos: numTotal,
    num_vendas: numVendas,
    num_abertos: r.num_abertos,
    num_cancelados: r.num_cancelados,
  };
}

// Ranking de vendedores ----------------------------------------------

export interface VendedorRankRow {
  vendedor_id: string;
  vendedor_nome: string | null;
  vendedor_whatsapp: string;
  faturamento_brl: number;
  num_vendas: number;
  num_orcamentos: number;
  ticket_medio_brl: number;
  conversao: number;
  tempo_medio_fechamento_horas: number | null;
}

export async function getRankingVendedores(range: DashboardRange, scope: VendedorScope): Promise<VendedorRankRow[]> {
  const params: any[] = [range.de, range.ate];
  const vf = vendedorClause('o.vendedor_id', scope, 3);
  if (vf.param) params.push(vf.param);

  const { rows } = await pool.query(
    `SELECT
       v.id   AS vendedor_id,
       v.nome AS vendedor_nome,
       v.numero_whatsapp AS vendedor_whatsapp,
       COALESCE(SUM(o.total) FILTER (WHERE o.status = 'venda'), 0)::float AS faturamento_brl,
       COUNT(*) FILTER (WHERE o.status = 'venda')::int  AS num_vendas,
       COUNT(*)::int                                    AS num_orcamentos,
       AVG(EXTRACT(EPOCH FROM (o.atualizado_em - o.criado_em)) / 3600.0)
         FILTER (WHERE o.status = 'venda' AND o.atualizado_em IS NOT NULL)::float
         AS tempo_medio_fechamento_horas
     FROM orcamentos o
     JOIN vendedores v ON v.id = o.vendedor_id
     WHERE o.criado_em >= $1 AND o.criado_em < $2${vf.sql}
     GROUP BY v.id, v.nome, v.numero_whatsapp
     ORDER BY faturamento_brl DESC
     LIMIT 50`,
    params
  );

  return rows.map((r: any) => ({
    vendedor_id: r.vendedor_id,
    vendedor_nome: r.vendedor_nome,
    vendedor_whatsapp: r.vendedor_whatsapp,
    faturamento_brl: Number(r.faturamento_brl),
    num_vendas: r.num_vendas,
    num_orcamentos: r.num_orcamentos,
    ticket_medio_brl: r.num_vendas > 0 ? Number(r.faturamento_brl) / r.num_vendas : 0,
    conversao: r.num_orcamentos > 0 ? r.num_vendas / r.num_orcamentos : 0,
    tempo_medio_fechamento_horas: r.tempo_medio_fechamento_horas != null ? Number(r.tempo_medio_fechamento_horas) : null,
  }));
}

// Top produtos --------------------------------------------------------

export interface ProdutoAgregRow {
  descricao: string;
  marca: string | null;
  qtd_total: number;
  valor_total_brl: number;
  num_orcamentos: number;
}

interface TopProdutosResult {
  mais_vendidos: ProdutoAgregRow[];
  mais_cotados_sem_venda: ProdutoAgregRow[];
  encalhados: { id: number; codigo: string; descricao: string; marca: string | null; preco_venda: number | null; ultima_aparicao: string | null }[];
}

export async function getTopProdutos(range: DashboardRange, scope: VendedorScope, limit = 10): Promise<TopProdutosResult> {
  // Agregação por item via jsonb_array_elements. Cada item dentro de orcamentos.itens
  // tem shape { descricao, marca, qtd, preco_unit, subtotal }.
  // Agrupamos por (descricao, marca) — não há FK pra products dentro do JSON.
  const params: any[] = [range.de, range.ate];
  const vf = vendedorClause('o.vendedor_id', scope, 3);
  if (vf.param) params.push(vf.param);

  const baseFromWhere = `
    FROM orcamentos o,
         LATERAL jsonb_array_elements(o.itens) AS item
    WHERE o.criado_em >= $1 AND o.criado_em < $2${vf.sql}
  `;

  const aggSelect = `
    SELECT
      item->>'descricao' AS descricao,
      item->>'marca'     AS marca,
      SUM((item->>'qtd')::numeric)::float       AS qtd_total,
      SUM((item->>'subtotal')::numeric)::float  AS valor_total_brl,
      COUNT(DISTINCT o.id)::int                 AS num_orcamentos
  `;

  const [vendidos, cotadosSemVenda] = await Promise.all([
    pool.query(
      `${aggSelect}
       ${baseFromWhere} AND o.status = 'venda'
       GROUP BY descricao, marca
       ORDER BY qtd_total DESC
       LIMIT ${limit}`,
      params
    ),
    pool.query(
      `${aggSelect}
       ${baseFromWhere} AND o.status = 'cancelado'
       GROUP BY descricao, marca
       ORDER BY qtd_total DESC
       LIMIT ${limit}`,
      params
    ),
  ]);

  // Encalhados: produtos ativos que NÃO apareceram em orçamento algum nos últimos 90 dias.
  // Não respeita o filtro do range (é "global histórico"), mas respeita o escopo de vendedor.
  const noventaDiasAtras = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const encalhParams: any[] = [noventaDiasAtras];
  const encalhVf = vendedorClause('o.vendedor_id', scope, 2);
  if (encalhVf.param) encalhParams.push(encalhVf.param);

  const encalhados = await pool.query(
    `WITH ativos AS (
       SELECT id, codigo, descricao, marca, preco_venda
       FROM products WHERE ativo = true
     ),
     vistos AS (
       SELECT lower(item->>'descricao') AS d_low,
              MAX(o.criado_em) AS ultima_aparicao
       FROM orcamentos o, LATERAL jsonb_array_elements(o.itens) AS item
       WHERE o.criado_em >= $1${encalhVf.sql}
       GROUP BY d_low
     )
     SELECT a.id, a.codigo, a.descricao, a.marca, a.preco_venda::float,
            v.ultima_aparicao
     FROM ativos a
     LEFT JOIN vistos v ON v.d_low = lower(a.descricao)
     WHERE v.d_low IS NULL
     ORDER BY a.descricao ASC
     LIMIT ${limit}`,
    encalhParams
  );

  const mapRow = (r: any): ProdutoAgregRow => ({
    descricao: r.descricao,
    marca: r.marca,
    qtd_total: Number(r.qtd_total) || 0,
    valor_total_brl: Number(r.valor_total_brl) || 0,
    num_orcamentos: r.num_orcamentos,
  });

  return {
    mais_vendidos: vendidos.rows.map(mapRow),
    mais_cotados_sem_venda: cotadosSemVenda.rows.map(mapRow),
    encalhados: encalhados.rows.map((r: any) => ({
      id: r.id,
      codigo: r.codigo,
      descricao: r.descricao,
      marca: r.marca,
      preco_venda: r.preco_venda != null ? Number(r.preco_venda) : null,
      ultima_aparicao: r.ultima_aparicao ? new Date(r.ultima_aparicao).toISOString() : null,
    })),
  };
}

// Clientes -----------------------------------------------------------

export interface ClienteAgregRow {
  cliente_id: string | null;
  cliente_nome: string;
  faturamento_brl: number;
  num_vendas: number;
  ultima_compra: string | null;
}

export interface AbcBucket { letra: 'A' | 'B' | 'C'; faixa_faturamento_pct: number; clientes: number; faturamento_brl: number; }

export interface ClientesAnaliseResult {
  top_compradores: ClienteAgregRow[];
  inativos: ClienteAgregRow[];
  abc: { buckets: AbcBucket[]; total_clientes: number; faturamento_total_brl: number };
}

// Distribui clientes ordenados por faturamento em A (80% do faturamento),
// B (próximos 15%), C (últimos 5%). Acumulado da curva clássica.
export function computeAbc(clienteFaturamentos: number[]): AbcBucket[] {
  const total = clienteFaturamentos.reduce((acc, v) => acc + v, 0);
  if (total <= 0) {
    return [
      { letra: 'A', faixa_faturamento_pct: 0, clientes: 0, faturamento_brl: 0 },
      { letra: 'B', faixa_faturamento_pct: 0, clientes: 0, faturamento_brl: 0 },
      { letra: 'C', faixa_faturamento_pct: 0, clientes: 0, faturamento_brl: 0 },
    ];
  }
  const ordered = [...clienteFaturamentos].sort((a, b) => b - a);
  const buckets: Record<'A' | 'B' | 'C', { clientes: number; faturamento_brl: number }> = {
    A: { clientes: 0, faturamento_brl: 0 },
    B: { clientes: 0, faturamento_brl: 0 },
    C: { clientes: 0, faturamento_brl: 0 },
  };
  let acumulado = 0;
  for (const fat of ordered) {
    const pctAtual = acumulado / total;
    const letra: 'A' | 'B' | 'C' = pctAtual < 0.8 ? 'A' : pctAtual < 0.95 ? 'B' : 'C';
    buckets[letra].clientes += 1;
    buckets[letra].faturamento_brl += fat;
    acumulado += fat;
  }
  return (['A', 'B', 'C'] as const).map(letra => ({
    letra,
    faixa_faturamento_pct: total > 0 ? buckets[letra].faturamento_brl / total : 0,
    clientes: buckets[letra].clientes,
    faturamento_brl: buckets[letra].faturamento_brl,
  }));
}

export async function getClientesAnalise(range: DashboardRange, scope: VendedorScope, limit = 10): Promise<ClientesAnaliseResult> {
  const params: any[] = [range.de, range.ate];
  const vf = vendedorClause('o.vendedor_id', scope, 3);
  if (vf.param) params.push(vf.param);

  // Top compradores no período (somente status=venda).
  // Agrupa por cliente_id quando existe; senão pelo cliente_nome (snapshot).
  const top = await pool.query(
    `SELECT
       o.cliente_id,
       COALESCE(o.cliente_nome, '(sem cliente)') AS cliente_nome,
       SUM(o.total)::float AS faturamento_brl,
       COUNT(*)::int       AS num_vendas,
       MAX(o.criado_em)    AS ultima_compra
     FROM orcamentos o
     WHERE o.status = 'venda' AND o.criado_em >= $1 AND o.criado_em < $2${vf.sql}
     GROUP BY o.cliente_id, COALESCE(o.cliente_nome, '(sem cliente)')
     ORDER BY faturamento_brl DESC
     LIMIT ${limit}`,
    params
  );

  // Inativos: clientes com pelo menos uma venda histórica mas sem venda nos últimos 60 dias.
  // Ignora o range — "inativo" é um sinal absoluto, não relativo ao período do filtro.
  const sessentaDiasAtras = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const inatParams: any[] = [sessentaDiasAtras];
  const inatVf = vendedorClause('o.vendedor_id', scope, 2);
  if (inatVf.param) inatParams.push(inatVf.param);

  const inativos = await pool.query(
    `WITH ult AS (
       SELECT o.cliente_id, COALESCE(o.cliente_nome, '(sem cliente)') AS cliente_nome,
              MAX(o.criado_em) AS ultima_compra,
              SUM(o.total)::float AS faturamento_brl,
              COUNT(*)::int AS num_vendas
       FROM orcamentos o
       WHERE o.status = 'venda'${inatVf.sql}
       GROUP BY o.cliente_id, COALESCE(o.cliente_nome, '(sem cliente)')
     )
     SELECT * FROM ult WHERE ultima_compra < $1
     ORDER BY ultima_compra ASC
     LIMIT ${limit}`,
    inatParams
  );

  // ABC: precisa do faturamento de TODOS os clientes no período (não só top N).
  const abcParams: any[] = [range.de, range.ate];
  const abcVf = vendedorClause('o.vendedor_id', scope, 3);
  if (abcVf.param) abcParams.push(abcVf.param);
  const abcRows = await pool.query(
    `SELECT SUM(o.total)::float AS fat
     FROM orcamentos o
     WHERE o.status = 'venda' AND o.criado_em >= $1 AND o.criado_em < $2${abcVf.sql}
     GROUP BY o.cliente_id, COALESCE(o.cliente_nome, '(sem cliente)')`,
    abcParams
  );
  const abcValues: number[] = abcRows.rows.map((r: any) => Number(r.fat) || 0);
  const abcBuckets = computeAbc(abcValues);
  const faturamentoTotal = abcValues.reduce((a, b) => a + b, 0);

  const mapRow = (r: any): ClienteAgregRow => ({
    cliente_id: r.cliente_id,
    cliente_nome: r.cliente_nome,
    faturamento_brl: Number(r.faturamento_brl) || 0,
    num_vendas: r.num_vendas,
    ultima_compra: r.ultima_compra ? new Date(r.ultima_compra).toISOString() : null,
  });

  return {
    top_compradores: top.rows.map(mapRow),
    inativos: inativos.rows.map(mapRow),
    abc: { buckets: abcBuckets, total_clientes: abcValues.length, faturamento_total_brl: faturamentoTotal },
  };
}

// Funil --------------------------------------------------------------

export interface FunilResult {
  mensagens_in: number;        // mensagens com papel='user' no período
  orcamentos: number;          // orçamentos criados no período (qualquer status)
  vendas: number;              // orçamentos com status='venda' criados no período
  taxa_msg_para_orc: number;   // orcamentos / mensagens_in
  taxa_orc_para_venda: number; // vendas / orcamentos
}

export async function getFunil(range: DashboardRange, scope: VendedorScope): Promise<FunilResult> {
  const msgParams: any[] = [range.de, range.ate];
  const msgVf = vendedorClause('vendedor_id', scope, 3);
  if (msgVf.param) msgParams.push(msgVf.param);
  const msg = await pool.query(
    `SELECT COUNT(*)::int AS n FROM mensagens
     WHERE papel = 'user' AND criado_em >= $1 AND criado_em < $2${msgVf.sql}`,
    msgParams
  );

  const orcParams: any[] = [range.de, range.ate];
  const orcVf = vendedorClause('vendedor_id', scope, 3);
  if (orcVf.param) orcParams.push(orcVf.param);
  const orc = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'venda')::int AS vendas
     FROM orcamentos
     WHERE criado_em >= $1 AND criado_em < $2${orcVf.sql}`,
    orcParams
  );

  const mensagens_in = msg.rows[0].n;
  const orcamentos = orc.rows[0].total;
  const vendas = orc.rows[0].vendas;
  return {
    mensagens_in,
    orcamentos,
    vendas,
    taxa_msg_para_orc: mensagens_in > 0 ? orcamentos / mensagens_in : 0,
    taxa_orc_para_venda: orcamentos > 0 ? vendas / orcamentos : 0,
  };
}

// Custo de IA --------------------------------------------------------

export interface BreakdownRow { chave: string; tokens: number; cost_usd: number; calls: number; }

export interface CustoIaResult {
  total_tokens: number;
  total_cost_usd: number;
  calls: number;
  por_modelo: BreakdownRow[];
  por_purpose: BreakdownRow[];
  por_vendedor: (BreakdownRow & { vendedor_nome: string | null })[];
}

export async function getCustoIa(range: DashboardRange, scope: VendedorScope): Promise<CustoIaResult> {
  const baseParams: any[] = [range.de, range.ate];
  const baseVf = vendedorClause('a.vendedor_id', scope, 3);
  if (baseVf.param) baseParams.push(baseVf.param);
  const baseWhere = `WHERE a.created_at >= $1 AND a.created_at < $2${baseVf.sql}`;

  const [tot, porModelo, porPurpose, porVendedor] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(a.total_tokens), 0)::int   AS total_tokens,
         COALESCE(SUM(a.cost_usd), 0)::float     AS total_cost_usd,
         COUNT(*)::int                           AS calls
       FROM ai_usage a ${baseWhere}`,
      baseParams
    ),
    pool.query(
      `SELECT a.model AS chave,
              SUM(a.total_tokens)::int    AS tokens,
              SUM(a.cost_usd)::float      AS cost_usd,
              COUNT(*)::int               AS calls
       FROM ai_usage a ${baseWhere}
       GROUP BY a.model ORDER BY cost_usd DESC`,
      baseParams
    ),
    pool.query(
      `SELECT COALESCE(a.purpose, '(sem purpose)') AS chave,
              SUM(a.total_tokens)::int             AS tokens,
              SUM(a.cost_usd)::float               AS cost_usd,
              COUNT(*)::int                        AS calls
       FROM ai_usage a ${baseWhere}
       GROUP BY COALESCE(a.purpose, '(sem purpose)') ORDER BY cost_usd DESC`,
      baseParams
    ),
    pool.query(
      `SELECT a.vendedor_id AS chave,
              v.nome AS vendedor_nome,
              SUM(a.total_tokens)::int  AS tokens,
              SUM(a.cost_usd)::float    AS cost_usd,
              COUNT(*)::int             AS calls
       FROM ai_usage a
       LEFT JOIN vendedores v ON v.id = a.vendedor_id
       ${baseWhere}
       GROUP BY a.vendedor_id, v.nome ORDER BY cost_usd DESC LIMIT 20`,
      baseParams
    ),
  ]);

  const mapBr = (r: any): BreakdownRow => ({
    chave: r.chave ?? '(null)',
    tokens: Number(r.tokens) || 0,
    cost_usd: Number(r.cost_usd) || 0,
    calls: Number(r.calls) || 0,
  });

  return {
    total_tokens: Number(tot.rows[0].total_tokens) || 0,
    total_cost_usd: Number(tot.rows[0].total_cost_usd) || 0,
    calls: Number(tot.rows[0].calls) || 0,
    por_modelo: porModelo.rows.map(mapBr),
    por_purpose: porPurpose.rows.map(mapBr),
    por_vendedor: porVendedor.rows.map((r: any) => ({ ...mapBr(r), vendedor_nome: r.vendedor_nome })),
  };
}
