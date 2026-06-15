import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { sendWhatsAppMessage } from './whatsapp.js';
import { vincularOrcamento } from './negocios.js';
import { limparTexto, parseDescricao, classificarCategoria, CATEGORIAS } from './catalogo-enrich.js';

// Aceita pool OU client de transação (ambos têm .query). Permite reusar o
// enriquecimento dentro da transação do upload de estoque.
type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

// Recalcula os campos DERIVADOS de todos os produtos a partir da descrição:
// limpa o texto (mojibake), extrai marca/nome-base/variação/grupo-chave e
// classifica a categoria. A `categoria` só é gravada onde ainda está vazia —
// nunca sobrescreve a curadoria manual feita na tela de revisão (nem o que o
// upload de estoque preservou). Idempotente: rodar de novo não muda nada.
export async function reenriquecerProdutos(
  db: Queryable = pool,
  opts: { forcarCategoria?: boolean } = {}
): Promise<{ total: number; descricoesLimpas: number; categorizados: number }> {
  const { rows } = await db.query(`SELECT id, descricao, categoria FROM products`);
  let descricoesLimpas = 0;
  let categorizados = 0;
  const updates: any[][] = [];
  for (const r of rows) {
    const limpa = limparTexto(r.descricao);
    if (limpa !== r.descricao) descricoesLimpas++;
    const p = parseDescricao(limpa);
    if (!r.categoria) categorizados++;
    // Classifica sobre nome-base + marca (SEM o sabor) — senão palavras de sabor
    // ("cookies", "chocolate branco") disparam regras erradas (ex.: snacks) e os
    // sabores de um mesmo produto caem em categorias diferentes. Como o nome-base
    // é igual dentro do grupo, isto também garante categoria consistente no grupo.
    const cat = classificarCategoria(`${p.nomeBase} ${p.marca ?? ''}`);
    updates.push([r.id, limpa, p.marca, p.nomeBase, p.variacao, p.variacaoTipo, p.grupoChave, cat]);
  }

  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const valores = chunk
      .map((_r, ci) => {
        const b = ci * 8;
        return `($${b + 1}::int,$${b + 2}::text,$${b + 3}::text,$${b + 4}::text,$${b + 5}::text,$${b + 6}::text,$${b + 7}::text,$${b + 8}::text)`;
      })
      .join(',');
    // Por padrão preserva a categoria já gravada (curadoria/upload). forcarCategoria
    // sobrescreve — usado só no backfill inicial, quando nada foi curado ainda.
    const categoriaSet = opts.forcarCategoria
      ? 'v.categoria'
      : "COALESCE(NULLIF(p.categoria, ''), v.categoria)";
    await db.query(
      `UPDATE products p SET
         descricao = v.descricao,
         marca = v.marca,
         nome_base = v.nome_base,
         variacao = v.variacao,
         variacao_tipo = v.variacao_tipo,
         grupo_chave = v.grupo_chave,
         categoria = ${categoriaSet}
       FROM (VALUES ${valores}) AS v(id, descricao, marca, nome_base, variacao, variacao_tipo, grupo_chave, categoria)
       WHERE p.id = v.id`,
      chunk.flat()
    );
  }

  return { total: rows.length, descricoesLimpas, categorizados };
}

// numero_whatsapp sentinela do "vendedor lógico" que representa os pedidos
// nascidos no catálogo público. Não é um número real — o catálogo não conversa
// pelo WhatsApp; serve só pra satisfazer o vínculo vendedor->orçamento/negócio.
const VENDEDOR_CATALOGO_NUMERO = 'catalogo';
const VENDEDOR_CATALOGO_NOME = 'Catálogo Online';

export interface VariacaoLoja {
  id: number;          // id do SKU real (o pedido referencia este id)
  variacao: string | null;
  preco: number;
  imagem_url: string | null;
}

export interface GrupoLoja {
  grupoChave: string;
  nomeBase: string;
  marca: string | null;
  categoria: string | null;
  variacaoTipo: string | null; // 'sabor' | 'cor_tamanho' | null
  imagem: string | null;       // imagem representativa do grupo
  precoMin: number;
  precoMax: number;
  totalVariacoes: number;
  variacoes: VariacaoLoja[];
}

// Vitrine pública AGRUPADA: 1 card por produto (grupo_chave), com as variações
// (sabores/cores) dentro. Só entram produtos ativos COM preço. O filtro (texto/
// categoria/marca) é resolvido por GRUPO: se qualquer SKU do grupo casa, o card
// volta com TODAS as variações (ex.: buscar "shark pro" mostra todos os sabores).
// Os ids retornados são os SKUs reais — o pedido continua operando por SKU.
export async function listarProdutosLoja(opts: {
  q?: string;
  categoria?: string;
  marca?: string;
  pagina?: number;
  limite?: number;
}): Promise<{ itens: GrupoLoja[]; total: number }> {
  const limite = Math.min(Math.max(opts.limite ?? 24, 1), 60);
  const pagina = Math.max(opts.pagina ?? 1, 1);
  const offset = (pagina - 1) * limite;
  const q = (opts.q ?? '').trim();
  const categoria = (opts.categoria ?? '').trim();
  const marca = (opts.marca ?? '').trim();

  const params: any[] = [];
  const filtros: string[] = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    filtros.push(`(lower(descricao) LIKE $${i} OR lower(coalesce(marca,'')) LIKE $${i} OR lower(coalesce(tags,'')) LIKE $${i} OR lower(coalesce(nome_base,'')) LIKE $${i})`);
  }
  if (categoria) {
    params.push(categoria);
    filtros.push(`categoria = $${params.length}`);
  }
  if (marca) {
    params.push(marca.toLowerCase());
    filtros.push(`lower(coalesce(marca,'')) = $${params.length}`);
  }
  const filtroSql = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  // ativos: universo da vitrine. matched: grupos que casam o filtro. base: TODOS
  // os SKUs desses grupos (expande o grupo inteiro mesmo que o filtro de texto
  // tenha casado um único sabor).
  const cte = `
    WITH ativos AS (
      SELECT id, descricao, coalesce(nome_base, descricao) AS nome_base, marca, categoria,
             variacao, variacao_tipo, coalesce(grupo_chave, descricao) AS grupo_chave,
             preco_venda, imagem_url, tags
      FROM products
      WHERE ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0
    ),
    matched AS (
      SELECT DISTINCT grupo_chave FROM ativos ${filtroSql}
    ),
    base AS (
      SELECT a.* FROM ativos a JOIN matched m ON a.grupo_chave = m.grupo_chave
    ),
    grupos AS (
      SELECT
        grupo_chave,
        min(nome_base) AS nome_base,
        max(marca) AS marca,
        max(categoria) AS categoria,
        max(variacao_tipo) AS variacao_tipo,
        min(preco_venda) AS preco_min,
        max(preco_venda) AS preco_max,
        count(*)::int AS total_variacoes,
        (array_remove(array_agg(imagem_url ORDER BY (imagem_url IS NOT NULL) DESC, preco_venda), NULL))[1] AS imagem,
        jsonb_agg(jsonb_build_object(
          'id', id, 'variacao', variacao, 'preco', preco_venda, 'imagem_url', imagem_url
        ) ORDER BY variacao NULLS FIRST, preco_venda) AS variacoes
      FROM base
      GROUP BY grupo_chave
    )`;

  const { rows: countRows } = await pool.query(
    `${cte} SELECT count(*)::int AS n FROM grupos`,
    params
  );

  params.push(limite, offset);
  const { rows } = await pool.query(
    `${cte}
     SELECT * FROM grupos
     ORDER BY (imagem IS NOT NULL) DESC, lower(nome_base)
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    itens: rows.map((r) => ({
      grupoChave: r.grupo_chave,
      nomeBase: r.nome_base,
      marca: r.marca,
      categoria: r.categoria,
      variacaoTipo: r.variacao_tipo,
      imagem: r.imagem,
      precoMin: Number(r.preco_min),
      precoMax: Number(r.preco_max),
      totalVariacoes: r.total_variacoes,
      variacoes: (r.variacoes as any[]).map((v) => ({
        id: v.id,
        variacao: v.variacao,
        preco: Number(v.preco),
        imagem_url: v.imagem_url,
      })),
    })),
    total: countRows[0].n,
  };
}

// Categorias com pelo menos um grupo na vitrine, na ordem da taxonomia, com a
// contagem de grupos (cards) — alimenta os filtros do catálogo.
export async function listarCategoriasLoja(): Promise<{ slug: string; label: string; total: number }[]> {
  const { rows } = await pool.query(`
    SELECT coalesce(categoria, 'outros') AS slug, count(DISTINCT coalesce(grupo_chave, descricao))::int AS total
    FROM products
    WHERE ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0
    GROUP BY 1`);
  const contagem = new Map<string, number>(rows.map((r) => [r.slug, r.total]));
  return CATEGORIAS
    .map((c) => ({ slug: c.slug, label: c.label, total: contagem.get(c.slug) ?? 0 }))
    .filter((c) => c.total > 0);
}

// Marcas com pelo menos um grupo, ordenadas por contagem (desc). Dobra acento/
// caixa pra não duplicar marca (ex.: "UNIÃO" vs "UNIAO").
export async function listarMarcasLoja(): Promise<{ marca: string; total: number }[]> {
  const { rows } = await pool.query(`
    SELECT marca, count(DISTINCT coalesce(grupo_chave, descricao))::int AS total
    FROM products
    WHERE ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0
      AND marca IS NOT NULL AND marca <> ''
    GROUP BY marca ORDER BY total DESC, marca`);
  return rows.map((r) => ({ marca: r.marca, total: r.total }));
}

function soDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

async function getVendedorCatalogoId(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO vendedores (numero_whatsapp, nome)
     VALUES ($1, $2)
     ON CONFLICT (numero_whatsapp) DO UPDATE SET ativo = true
     RETURNING id`,
    [VENDEDOR_CATALOGO_NUMERO, VENDEDOR_CATALOGO_NOME]
  );
  return rows[0].id;
}

// Acha o cliente pelo telefone (celular ou fone, comparando só dígitos) ou cria
// um novo com o nome informado no checkout. Devolve id + nome canônico.
async function resolverOuCriarCliente(nome: string, telefone: string): Promise<{ id: string; nome: string }> {
  const tel = soDigitos(telefone);
  if (tel.length >= 8) {
    const { rows } = await pool.query(
      `SELECT id, nome FROM clientes
        WHERE regexp_replace(coalesce(celular, ''), '\\D', '', 'g') = $1
           OR regexp_replace(coalesce(fone, ''), '\\D', '', 'g') = $1
        ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC
        LIMIT 1`,
      [tel]
    );
    if (rows.length > 0) return { id: rows[0].id, nome: rows[0].nome };
  }

  const { rows } = await pool.query(
    `INSERT INTO clientes (nome, celular, situacao, ativo)
     VALUES ($1, $2, 'Ativo', true)
     RETURNING id, nome`,
    [nome.trim(), telefone.trim()]
  );
  return { id: rows[0].id, nome: rows[0].nome };
}

export interface ItemPedidoInput {
  produtoId: number;
  qtd: number;
}

export interface ResultadoPedido {
  numero: string;
  total: number;
  itens: { descricao: string; marca: string | null; qtd: number; preco_unit: number; subtotal: number }[];
  clienteNome: string;
}

export class PedidoInvalidoError extends Error {}

// Fluxo do pedido do catálogo. Reusa o numerador de ORC + o Kanban (negocios),
// mas NÃO conversa pelo WhatsApp: o pedido entra no sistema e a equipe trabalha
// pelo painel. Preço é SEMPRE resolvido no servidor (products.preco_venda) —
// nunca confiamos no valor vindo do navegador.
export async function criarPedidoCatalogo(opts: {
  nome: string;
  telefone: string;
  itens: ItemPedidoInput[];
}): Promise<ResultadoPedido> {
  const nome = (opts.nome ?? '').trim();
  const telefone = (opts.telefone ?? '').trim();
  if (nome.length < 2) throw new PedidoInvalidoError('Informe um nome válido.');
  if (soDigitos(telefone).length < 10) throw new PedidoInvalidoError('Informe um telefone válido com DDD.');

  // Normaliza/valida itens e descarta duplicados (soma quantidades do mesmo produto).
  const qtdPorId = new Map<number, number>();
  for (const it of opts.itens ?? []) {
    const id = Number(it?.produtoId);
    const qtd = Math.floor(Number(it?.qtd));
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!Number.isInteger(qtd) || qtd <= 0) continue;
    qtdPorId.set(id, (qtdPorId.get(id) ?? 0) + qtd);
  }
  if (qtdPorId.size === 0) throw new PedidoInvalidoError('Carrinho vazio ou inválido.');

  const ids = [...qtdPorId.keys()];
  const { rows: prods } = await pool.query(
    `SELECT id, descricao, marca, preco_venda
       FROM products
      WHERE id = ANY($1::int[]) AND ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0`,
    [ids]
  );
  if (prods.length === 0) throw new PedidoInvalidoError('Nenhum produto do carrinho está disponível.');

  const itens = prods.map((p) => {
    const qtd = qtdPorId.get(p.id)!;
    const preco_unit = Number(p.preco_venda);
    return {
      descricao: p.descricao as string,
      marca: (p.marca ?? null) as string | null,
      qtd,
      preco_unit,
      subtotal: Number((qtd * preco_unit).toFixed(2)),
    };
  });
  const total = Number(itens.reduce((s, i) => s + i.subtotal, 0).toFixed(2));

  const vendedorId = await getVendedorCatalogoId();
  const cliente = await resolverOuCriarCliente(nome, telefone);

  // Sessão sintética: o Kanban (negocios) é ancorado em sessao_id UNIQUE, então
  // cada pedido do catálogo é uma "conversa" própria de origem 'catalogo'.
  const { rows: sessRows } = await pool.query(
    `INSERT INTO sessoes (vendedor_id, status, origem, encerrada_em)
     VALUES ($1, 'orcamento_gerado', 'catalogo', NOW())
     RETURNING id`,
    [vendedorId]
  );
  const sessaoId = sessRows[0].id;

  const { rows: seqRows } = await pool.query(`SELECT nextval('orcamento_numero_seq') AS seq`);
  const numero = `ORC-${String(Number(seqRows[0].seq)).padStart(6, '0')}`;

  const { rows: orcRows } = await pool.query(
    `INSERT INTO orcamentos (numero, sessao_id, vendedor_id, cliente_id, cliente_nome, itens, total)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING id`,
    [numero, sessaoId, vendedorId, cliente.id, cliente.nome, JSON.stringify(itens), total]
  );

  await vincularOrcamento({
    sessaoId,
    vendedorId,
    orcamentoId: orcRows[0].id,
    orcamentoNumero: numero,
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    valor: total,
  });

  logger.info('pedido catalogo criado', { numero, total, itens: itens.length, cliente_id: cliente.id });

  // Notificação opcional: só dispara se houver um número humano configurado em
  // system_config.whatsapp_central. Vazio (padrão) = nada sai no WhatsApp.
  await notificarCentral(numero, cliente.nome, telefone, itens, total).catch((err) =>
    logger.error('falha ao notificar central do catalogo', { numero, err: err?.message })
  );

  return { numero, total, itens, clienteNome: cliente.nome };
}

async function notificarCentral(
  numero: string,
  clienteNome: string,
  telefone: string,
  itens: ResultadoPedido['itens'],
  total: number
): Promise<void> {
  const { rows } = await pool.query(`SELECT whatsapp_central FROM system_config WHERE id = 'default'`);
  const central = (rows[0]?.whatsapp_central ?? '').trim();
  if (!central) return;

  const fmt = (n: number) => n.toFixed(2).replace('.', ',');
  const linhas = itens
    .map((i, idx) => `${idx + 1}. ${i.descricao}${i.marca ? ` - ${i.marca}` : ''}\n   ${i.qtd} un. x R$ ${fmt(i.preco_unit)} = R$ ${fmt(i.subtotal)}`)
    .join('\n');
  const texto = `🛒 *Novo pedido do catálogo* (${numero})
Cliente: ${clienteNome}
Fone: ${telefone}
—————————————————
${linhas}
—————————————————
💰 *TOTAL: R$ ${fmt(total)}*`;
  await sendWhatsAppMessage(central, texto);
}
