import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { sendWhatsAppMessage, sendWhatsAppImage } from './whatsapp.js';
import { searchClientes, type ClienteMatch } from './search.js';
import { formatListaClientes } from './intents.js';
import { generateOrcamentoImages } from './imagem-orcamento.js';

const fmtBR = (n: number) => n.toFixed(2).replace('.', ',');

// Envia o orçamento como imagem(s) PNG. Best-effort: log e segue se falhar.
// Não bloqueia o fluxo principal — o texto com o orçamento já foi entregue.
// Pode emitir múltiplas imagens quando o orçamento é longo (paginação ~15 itens).
async function enviarImagensOrcamento(numero: string, senderNumber: string): Promise<void> {
  try {
    const imagens = await generateOrcamentoImages(numero);
    for (let i = 0; i < imagens.length; i++) {
      const sufixo = imagens.length > 1 ? `-p${i + 1}` : '';
      await sendWhatsAppImage({
        number: senderNumber,
        buffer: imagens[i],
        fileName: `${numero}${sufixo}.png`,
        mimetype: 'image/png',
      });
    }
  } catch (err: any) {
    logger.error('Failed to send orcamento images', { numero, err: err?.message });
  }
}

export function formatarTextoOrcamento(opts: {
  numero: string;
  clienteNome: string | null;
  itens: any[];
  total: number;
  cabecalho?: string;
  rodape?: string;
}): string {
  const linhas = opts.itens.map((it: any, i: number) => {
    const nome = String(it.descricao ?? '').trim();
    const marca = String(it.marca ?? '').trim();
    const nomeUpper = nome.toUpperCase();
    const marcaJaNoNome = marca && nomeUpper.includes(marca.toUpperCase());
    const nomeMarca = marca && !marcaJaNoNome ? `${nome} - ${marca}` : nome;
    const qtd = Number(it.qtd ?? 0);
    const pu = Number(it.preco_unit ?? 0);
    const sub = Number(it.subtotal ?? qtd * pu);
    return `${i + 1}. ${nomeMarca}\n   Qtd: ${qtd} un. x R$ ${fmtBR(pu)} = R$ ${fmtBR(sub)}`;
  }).join('\n\n');

  const cabecalho = opts.cabecalho || `📋 *ORÇAMENTO ${opts.numero}*`;
  const rodape = opts.rodape || `Orçamento ${opts.numero} salvo. Para um novo atendimento, é só enviar uma nova mensagem.`;

  return `${cabecalho}
—————————————————${opts.clienteNome ? `\nCliente: ${opts.clienteNome}` : ''}

${linhas}
—————————————————
💰 *TOTAL: R$ ${fmtBR(opts.total)}*
—————————————————

${rodape}`;
}

export async function gravarOrcamento(opts: {
  fnName: 'finalizar_orcamento' | 'alterar_orcamento';
  vendedorId: string;
  currentSessionId: string;
  senderNumber: string;
  itens: any[];
  total: number;
  clienteId: string | null;
  clienteNome: string;
  numeroAlvo?: string | null;
}): Promise<{ numero: string | null; replyText: string }> {
  const { fnName, vendedorId, currentSessionId, senderNumber, itens, total, clienteId, clienteNome } = opts;

  if (fnName === 'alterar_orcamento') {
    const numeroAlvo = opts.numeroAlvo;
    if (!numeroAlvo) {
      const reply = 'Não identifiquei qual orçamento alterar. Me passa o número (ex: ORC-000123).';
      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return { numero: null, replyText: reply };
    }
    const { rowCount } = await pool.query(
      `UPDATE orcamentos
       SET itens = $1::jsonb, total = $2, cliente_nome = $3, cliente_id = $4, atualizado_em = NOW()
       WHERE numero = $5 AND vendedor_id = $6 AND status = 'aberto'`,
      [JSON.stringify(itens), total, clienteNome, clienteId, numeroAlvo, vendedorId]
    );
    if ((rowCount ?? 0) === 0) {
      const reply = `Não consegui alterar o ${numeroAlvo} (já fechado ou cancelado).`;
      await sendWhatsAppMessage(senderNumber, reply);
      await pool.query(
        `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
        [currentSessionId, vendedorId, 'assistant', reply, 'texto']
      );
      return { numero: numeroAlvo, replyText: reply };
    }
    const replyText = formatarTextoOrcamento({
      numero: numeroAlvo,
      clienteNome,
      itens,
      total,
      cabecalho: `✏️ *ORÇAMENTO ${numeroAlvo} ATUALIZADO*`,
      rodape: `Orçamento ${numeroAlvo} atualizado e segue em aberto.`,
    });
    await sendWhatsAppMessage(senderNumber, replyText);
    await pool.query(
      `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
      [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
    );
    logger.info('orcamento alterado', { numero: numeroAlvo, total, itens: itens.length, cliente_id: clienteId });
    await enviarImagensOrcamento(numeroAlvo, senderNumber);
    return { numero: numeroAlvo, replyText };
  }

  // Finalização: cria novo orçamento
  const { rows: seqRows } = await pool.query(`SELECT nextval('orcamento_numero_seq') AS seq`);
  const seqNum = Number(seqRows[0].seq);
  const numero = `ORC-${String(seqNum).padStart(6, '0')}`;

  await pool.query(
    `INSERT INTO orcamentos (numero, sessao_id, vendedor_id, cliente_id, cliente_nome, itens, total)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [numero, currentSessionId, vendedorId, clienteId, clienteNome, JSON.stringify(itens), total]
  );

  await pool.query(
    `UPDATE sessoes SET status = 'orcamento_gerado', encerrada_em = NOW() WHERE id = $1`,
    [currentSessionId]
  );

  const replyText = formatarTextoOrcamento({ numero, clienteNome, itens, total });

  await sendWhatsAppMessage(senderNumber, replyText);
  await pool.query(
    `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
    [currentSessionId, vendedorId, 'assistant', replyText, 'texto']
  );
  logger.info('orcamento criado', { numero, total, itens: itens.length, cliente_id: clienteId });
  await enviarImagensOrcamento(numero, senderNumber);
  return { numero, replyText };
}

// Resolve cliente a partir de uma query livre. Decide se grava direto,
// pede pro vendedor escolher entre opções, ou oferece cadastrar novo.
export async function resolverClienteEGravar(opts: {
  fnName: 'finalizar_orcamento' | 'alterar_orcamento';
  vendedorId: string;
  currentSessionId: string;
  senderNumber: string;
  itens: any[];
  total: number;
  clienteQuery: string;
  numeroAlvo?: string | null;
}): Promise<void> {
  const { fnName, vendedorId, currentSessionId, senderNumber, itens, total, clienteQuery, numeroAlvo } = opts;

  const matches = await searchClientes(clienteQuery, 6);

  // Nenhum match → oferece cadastrar novo
  if (matches.length === 0) {
    await pool.query(
      `UPDATE sessoes SET acao_pendente = $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        tipo: 'selecionar_cliente',
        fn: fnName,
        candidatos: [],
        nome_sugerido: clienteQuery,
        itens, total,
        numero_alvo: numeroAlvo || null,
      }), currentSessionId]
    );
    const reply = `Não achei nenhum cliente parecido com "${clienteQuery}" na base.\n\nQuer que eu cadastre *${clienteQuery}* como novo cliente e siga com o orçamento? Responda *novo* para cadastrar ou *cancela*.`;
    await sendWhatsAppMessage(senderNumber, reply);
    await pool.query(
      `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
      [currentSessionId, vendedorId, 'assistant', reply, 'texto']
    );
    return;
  }

  // Match único forte → grava direto
  const isMatchForte = (m: ClienteMatch) =>
    m.match_type === 'documento' || m.match_type === 'externo_id' || m.match_type === 'telefone' ||
    (m.match_type === 'fuzzy' && m.score >= 0.7);

  if (matches.length === 1 && isMatchForte(matches[0])) {
    const c = matches[0];
    await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
    await gravarOrcamento({
      fnName, vendedorId, currentSessionId, senderNumber,
      itens, total,
      clienteId: c.id,
      clienteNome: c.nome,
      numeroAlvo: numeroAlvo || null,
    });
    return;
  }

  // Múltiplos OU match fraco → pergunta
  await pool.query(
    `UPDATE sessoes SET acao_pendente = $1::jsonb WHERE id = $2`,
    [JSON.stringify({
      tipo: 'selecionar_cliente',
      fn: fnName,
      candidatos: matches,
      nome_sugerido: clienteQuery,
      itens, total,
      numero_alvo: numeroAlvo || null,
    }), currentSessionId]
  );
  const reply = `Achei ${matches.length} cliente${matches.length > 1 ? 's' : ''} parecido${matches.length > 1 ? 's' : ''} com "${clienteQuery}":\n\n${formatListaClientes(matches)}\n\nResponda com o *número* do cliente certo, *novo* pra cadastrar um novo, ou *cancela*.`;
  await sendWhatsAppMessage(senderNumber, reply);
  await pool.query(
    `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
    [currentSessionId, vendedorId, 'assistant', reply, 'texto']
  );
}
