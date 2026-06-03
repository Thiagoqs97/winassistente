import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

// Estágios do funil (colunas do Kanban), na ordem natural de avanço.
// 'cancelado' é terminal e fica fora da ordem — só se chega nele por ação
// explícita (cancelamento), nunca por avanço automático.
export const ESTAGIOS = [
  'novo_contato',
  'em_andamento',
  'orcamento',
  'expedicao',
  'recebido',
  'cancelado',
] as const;

export type Estagio = (typeof ESTAGIOS)[number];

const ORDEM: Record<Estagio, number> = {
  novo_contato: 0,
  em_andamento: 1,
  orcamento: 2,
  expedicao: 3,
  recebido: 4,
  cancelado: -1,
};

export function isEstagio(v: unknown): v is Estagio {
  return typeof v === 'string' && (ESTAGIOS as readonly string[]).includes(v);
}

// Status do orçamento que corresponde a cada estágio do funil. Como arrastar um
// cartão altera o status REAL do orçamento, esse é o mapeamento canônico.
export function estagioParaStatusOrc(estagio: Estagio): 'aberto' | 'venda' | 'cancelado' {
  if (estagio === 'cancelado') return 'cancelado';
  if (estagio === 'expedicao' || estagio === 'recebido') return 'venda';
  return 'aberto'; // novo_contato, em_andamento, orcamento
}

// Garante que existe um negócio para a sessão (cartão "Novo Contato"). Idempotente.
export async function ensureNegocio(sessaoId: string, vendedorId: string): Promise<void> {
  await pool.query(
    `INSERT INTO negocios (sessao_id, vendedor_id, estagio)
     VALUES ($1, $2, 'novo_contato')
     ON CONFLICT (sessao_id) DO NOTHING`,
    [sessaoId, vendedorId]
  );
}

// Avança o estágio do negócio da sessão, mas só PRA FRENTE — nunca regride
// automaticamente e nunca mexe num negócio já cancelado. Movimentos pra trás
// só acontecem por ação manual (arrastar) ou conversa explícita.
export async function avancarEstagioAuto(sessaoId: string, alvo: Estagio): Promise<void> {
  const { rows } = await pool.query(`SELECT estagio FROM negocios WHERE sessao_id = $1`, [sessaoId]);
  const atual = rows[0]?.estagio as Estagio | undefined;
  if (!atual || atual === 'cancelado') return;
  if (ORDEM[alvo] <= ORDEM[atual]) return;
  await pool.query(
    `UPDATE negocios SET estagio = $2, atualizado_em = NOW() WHERE sessao_id = $1`,
    [sessaoId, alvo]
  );
}

// Vincula o orçamento recém-gerado ao negócio da sessão e o move pra coluna
// "Orçamento". Upsert: cria o negócio caso (por algum motivo) ainda não exista.
export async function vincularOrcamento(opts: {
  sessaoId: string;
  vendedorId: string;
  orcamentoId: string;
  orcamentoNumero: string;
  clienteId: string | null;
  clienteNome: string | null;
  valor: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO negocios
       (sessao_id, vendedor_id, cliente_id, cliente_nome, orcamento_id, orcamento_numero, estagio, valor)
     VALUES ($1, $2, $3, $4, $5, $6, 'orcamento', $7)
     ON CONFLICT (sessao_id) DO UPDATE SET
       estagio = CASE WHEN negocios.estagio = 'cancelado' THEN negocios.estagio ELSE 'orcamento' END,
       orcamento_id = EXCLUDED.orcamento_id,
       orcamento_numero = EXCLUDED.orcamento_numero,
       cliente_id = EXCLUDED.cliente_id,
       cliente_nome = EXCLUDED.cliente_nome,
       valor = EXCLUDED.valor,
       atualizado_em = NOW()`,
    [opts.sessaoId, opts.vendedorId, opts.clienteId, opts.clienteNome, opts.orcamentoId, opts.orcamentoNumero, opts.valor]
  );
}

// Atualiza dados do negócio quando o orçamento vinculado é alterado (mantém o
// estágio — uma alteração não muda a posição no funil).
export async function atualizarDadosPorOrcamento(opts: {
  orcamentoNumero: string;
  clienteId: string | null;
  clienteNome: string | null;
  valor: number;
}): Promise<void> {
  await pool.query(
    `UPDATE negocios
       SET cliente_id = $2, cliente_nome = $3, valor = $4, atualizado_em = NOW()
     WHERE orcamento_numero = $1`,
    [opts.orcamentoNumero, opts.clienteId, opts.clienteNome, opts.valor]
  );
}

// Sincroniza o estágio do negócio quando o STATUS do orçamento muda por fora do
// Kanban (confirmação no WhatsApp, painel de Orçamentos, etc.). Preserva
// 'recebido' quando o status vira 'venda' (recebido também é uma venda, e é um
// estágio mais avançado que expedição).
export async function syncEstagioPorStatusOrc(
  orcamentoNumero: string,
  status: 'aberto' | 'venda' | 'cancelado',
): Promise<void> {
  const alvo: Estagio = status === 'cancelado' ? 'cancelado' : status === 'venda' ? 'expedicao' : 'orcamento';
  await pool.query(
    `UPDATE negocios
       SET estagio = CASE WHEN $2 = 'expedicao' AND estagio = 'recebido' THEN 'recebido' ELSE $2 END,
           atualizado_em = NOW()
     WHERE orcamento_numero = $1`,
    [orcamentoNumero, alvo]
  );
}

// Marca o estágio de um negócio a partir do NÚMERO do orçamento (usado pelas
// intents de conversa: "o ORC-123 foi enviado/recebido"). Move o negócio e
// sincroniza o status do orçamento. Retorna o cliente p/ a mensagem de resposta,
// ou ok=false se o orçamento não existe / não é do vendedor.
export async function marcarEstagioPorNumero(opts: {
  orcamentoNumero: string;
  estagio: Estagio;
  vendedorId?: string | null;
}): Promise<{ ok: boolean; clienteNome: string | null }> {
  const params: any[] = [opts.orcamentoNumero];
  let scope = '';
  if (opts.vendedorId) { params.push(opts.vendedorId); scope = ' AND vendedor_id = $2'; }
  const { rows } = await pool.query(
    `SELECT id, cliente_nome FROM orcamentos WHERE numero = $1${scope}`,
    params
  );
  const orc = rows[0];
  if (!orc) return { ok: false, clienteNome: null };

  const novoStatus = estagioParaStatusOrc(opts.estagio);
  await pool.query(
    `UPDATE orcamentos SET status = $2, atualizado_em = NOW() WHERE id = $1`,
    [orc.id, novoStatus]
  );
  await pool.query(
    `UPDATE negocios SET estagio = $2, atualizado_em = NOW() WHERE orcamento_id = $1`,
    [orc.id, opts.estagio]
  );
  return { ok: true, clienteNome: orc.cliente_nome };
}

export interface NegocioRow {
  id: string;
  sessao_id: string | null;
  vendedor_id: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  orcamento_id: string | null;
  orcamento_numero: string | null;
  estagio: Estagio;
  valor: string | null;
  arquivado: boolean;
  criado_em: string;
  atualizado_em: string;
}

// Move um negócio para um estágio (ação manual do Kanban). Aplica o isolamento
// por vendedor e sincroniza o status do orçamento vinculado. Retorna o negócio
// atualizado ou null se não encontrado / fora do escopo do usuário.
export async function moverEstagio(opts: {
  negocioId: string;
  estagio: Estagio;
  vendedorScope: string | null; // sub-login vinculado vê só os próprios
}): Promise<NegocioRow | null> {
  const params: any[] = [opts.negocioId];
  let scopeWhere = '';
  if (opts.vendedorScope) {
    params.push(opts.vendedorScope);
    scopeWhere = ' AND vendedor_id = $2';
  }
  const { rows } = await pool.query(
    `UPDATE negocios SET estagio = $${params.length + 1}, atualizado_em = NOW()
     WHERE id = $1${scopeWhere}
     RETURNING *`,
    [...params, opts.estagio]
  );
  const negocio = rows[0] as NegocioRow | undefined;
  if (!negocio) return null;

  // Propaga pro status real do orçamento (decisão de produto: arrastar muda o ORC).
  if (negocio.orcamento_numero) {
    const novoStatus = estagioParaStatusOrc(opts.estagio);
    try {
      await pool.query(
        `UPDATE orcamentos SET status = $2, atualizado_em = NOW() WHERE numero = $1`,
        [negocio.orcamento_numero, novoStatus]
      );
    } catch (err: any) {
      logger.error('moverEstagio: falha ao sincronizar status do orçamento', {
        numero: negocio.orcamento_numero, err: err?.message,
      });
    }
  }
  return negocio;
}
