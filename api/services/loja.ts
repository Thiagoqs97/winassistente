import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { sendWhatsAppMessage } from './whatsapp.js';
import { vincularOrcamento } from './negocios.js';

// numero_whatsapp sentinela do "vendedor lógico" que representa os pedidos
// nascidos no catálogo público. Não é um número real — o catálogo não conversa
// pelo WhatsApp; serve só pra satisfazer o vínculo vendedor->orçamento/negócio.
const VENDEDOR_CATALOGO_NUMERO = 'catalogo';
const VENDEDOR_CATALOGO_NOME = 'Catálogo Online';

export interface ProdutoLoja {
  id: number;
  descricao: string;
  marca: string | null;
  preco: number | null;
  imagem_url: string | null;
}

// Só produtos ativos COM preço entram na vitrine — sem preço não dá pra montar
// pedido. Busca opcional por descrição/marca via trigram (mesmo índice do agente).
export async function listarProdutosLoja(opts: {
  q?: string;
  pagina?: number;
  limite?: number;
}): Promise<{ itens: ProdutoLoja[]; total: number }> {
  const limite = Math.min(Math.max(opts.limite ?? 24, 1), 60);
  const pagina = Math.max(opts.pagina ?? 1, 1);
  const offset = (pagina - 1) * limite;
  const q = (opts.q ?? '').trim();

  const where = `ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0`;
  const params: any[] = [];
  let filtro = '';
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    filtro = `AND (lower(descricao) LIKE $1 OR lower(coalesce(marca, '')) LIKE $1 OR lower(coalesce(tags, '')) LIKE $1)`;
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM products WHERE ${where} ${filtro}`,
    params
  );

  params.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT id, descricao, marca, preco_venda AS preco, imagem_url
       FROM products
      WHERE ${where} ${filtro}
      ORDER BY (imagem_url IS NOT NULL) DESC, lower(descricao)
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    itens: rows.map((r) => ({
      id: r.id,
      descricao: r.descricao,
      marca: r.marca,
      preco: r.preco === null ? null : Number(r.preco),
      imagem_url: r.imagem_url,
    })),
    total: countRows[0].n,
  };
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
