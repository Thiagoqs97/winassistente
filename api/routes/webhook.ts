import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { ensureDB } from '../db/migrations.js';
import { logger } from '../lib/logger.js';
import { chatComplete } from '../lib/ai.js';
import { sendWhatsAppMessage } from '../services/whatsapp.js';
import { searchProducts, searchClientes, type ClienteMatch } from '../services/search.js';
import { gravarOrcamento, resolverClienteEGravar } from '../services/orcamentos.js';
import { transcribeAudio, describeImage, parseSpreadsheet, parseCsv } from '../services/media.js';
import {
  parseNomeVendedor,
  parseConfirmacao,
  parseEscolha,
  formatListaClientes,
  normalizarNumeroOrcamento,
} from '../services/intents.js';
import {
  EXTRACT_INTENT_PROMPT,
  buildAlteracaoBlock,
  buildFinalPrompt,
  buildStockContext,
  type OrcamentoEmAlteracao,
} from '../agents/prompts.js';
import { tools, SUPPORTED_FN_NAMES } from '../agents/tools.js';

export const webhookRouter = Router();

type TipoMidia = 'texto' | 'audio' | 'imagem' | 'pdf' | 'planilha';

const fmtBR = (n: any) => Number(n ?? 0).toFixed(2).replace('.', ',');

function ack(res: Response) {
  if (!res.headersSent) res.json({ status: 'ok' });
}

async function gravarMensagem(sessaoId: string, vendedorId: string, papel: 'user' | 'assistant', conteudo: string, tipoMidia: TipoMidia = 'texto') {
  await pool.query(
    `INSERT INTO mensagens (sessao_id, vendedor_id, papel, conteudo, tipo_midia) VALUES ($1, $2, $3, $4, $5)`,
    [sessaoId, vendedorId, papel, conteudo, tipoMidia]
  );
}

async function replyAndLog(senderNumber: string, sessaoId: string, vendedorId: string, text: string) {
  await sendWhatsAppMessage(senderNumber, text);
  await gravarMensagem(sessaoId, vendedorId, 'assistant', text, 'texto');
}

webhookRouter.post('/webhook/evolution', async (req, res) => {
  const event = req.body;

  if (event.event !== 'messages.upsert') { ack(res); return; }

  const key = event.data?.key;
  const msg = event.data?.message;
  if (!msg || key?.fromMe) { ack(res); return; }

  const remoteJid: string = key.remoteJid || '';
  if (remoteJid.endsWith('@g.us')) { ack(res); return; }

  // WhatsApp Business às vezes vem com @lid. Preferimos o remoteJidAlt quando termina em @s.whatsapp.net.
  const phoneJid: string = key.remoteJidAlt && key.remoteJidAlt.endsWith('@s.whatsapp.net')
    ? key.remoteJidAlt
    : remoteJid;
  const senderNumber = phoneJid
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '');

  let incomingText = msg.conversation || msg.extendedTextMessage?.text || '';
  let tipoMidia: TipoMidia = 'texto';

  try {
    await ensureDB();

    const base64Data: string | undefined = msg.base64 || event.data?.message?.base64;

    if (msg.audioMessage && base64Data) {
      try {
        tipoMidia = 'audio';
        incomingText = await transcribeAudio(base64Data);
        logger.info('Audio transcribed', { senderNumber, len: incomingText.length });
      } catch (err: any) {
        logger.error('Audio transcription failed', { err: err?.message });
      }
    }

    if (msg.imageMessage && base64Data) {
      try {
        tipoMidia = 'imagem';
        incomingText = await describeImage(base64Data);
        logger.info('Image processed', { senderNumber, len: incomingText.length });
      } catch (err: any) {
        logger.error('Image processing failed', { err: err?.message });
      }
    }

    if (msg.documentMessage && base64Data && !incomingText) {
      try {
        const mimeType: string = msg.documentMessage.mimetype || '';
        const fileName: string = msg.documentMessage.fileName || '';
        if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || /\.(xlsx|xls)$/i.test(fileName)) {
          tipoMidia = 'planilha';
          incomingText = parseSpreadsheet(base64Data);
        } else if (/\.csv$/i.test(fileName) || mimeType.includes('csv')) {
          tipoMidia = 'planilha';
          incomingText = parseCsv(base64Data);
        }
      } catch (err: any) {
        logger.error('Document processing failed', { err: err?.message });
      }
    }

    if (!incomingText || incomingText.trim().length === 0) return;

    const { rows: configRows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    const config = configRows[0] || { core_prompt: '', session_timeout_hours: 2 };
    const sessionTimeoutHours = config.session_timeout_hours || 2;

    // Vendedor: insert ou recupera
    const { rows: vendRows } = await pool.query(
      `INSERT INTO vendedores (numero_whatsapp) VALUES ($1)
       ON CONFLICT (numero_whatsapp) DO UPDATE SET ativo = true
       RETURNING id, nome`,
      [senderNumber]
    );
    const vendedorId = vendRows[0].id;
    let vendedorNome: string | null = vendRows[0].nome;

    // Sessão: carrega ativa OU encerra por timeout e cria nova
    let currentSessionId: string | undefined;
    const now = new Date();

    const { rows: sessionRows } = await pool.query(
      `SELECT id, iniciada_em, status FROM sessoes WHERE vendedor_id = $1 AND status = 'ativa' ORDER BY iniciada_em DESC LIMIT 1`,
      [vendedorId]
    );

    if (sessionRows.length > 0) {
      const activeSession = sessionRows[0];
      const { rows: lastMsgRows } = await pool.query(
        `SELECT criado_em FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em DESC LIMIT 1`,
        [activeSession.id]
      );
      const lastMsgDate = lastMsgRows.length > 0
        ? new Date(lastMsgRows[0].criado_em)
        : new Date(activeSession.iniciada_em);
      const diffHours = (now.getTime() - lastMsgDate.getTime()) / (1000 * 60 * 60);

      if (diffHours > sessionTimeoutHours) {
        await pool.query(`UPDATE sessoes SET status = 'encerrada', encerrada_em = NOW() WHERE id = $1`, [activeSession.id]);
      } else {
        currentSessionId = activeSession.id;
      }
    }

    if (!currentSessionId) {
      const { rows: newSessionRows } = await pool.query(
        `INSERT INTO sessoes (vendedor_id) VALUES ($1) RETURNING id`,
        [vendedorId]
      );
      currentSessionId = newSessionRows[0].id;
    }

    // Onboarding: bloqueia até termos o nome do vendedor
    if (!vendedorNome) {
      await gravarMensagem(currentSessionId!, vendedorId, 'user', incomingText, tipoMidia);

      const { rows: askCountRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM mensagens WHERE sessao_id = $1 AND papel = 'assistant'`,
        [currentSessionId]
      );
      const jaPerguntou = askCountRows[0].n > 0;

      let reply: string;
      if (!jaPerguntou) {
        reply = 'Olá! 👋 Sou o assistente da Win Distribuidora.\n\nAntes de começarmos, qual é o seu nome? (assim eu vincular seus orçamentos corretamente)';
      } else {
        const nomeExtraido = parseNomeVendedor(incomingText);
        if (nomeExtraido) {
          await pool.query(`UPDATE vendedores SET nome = $1 WHERE id = $2`, [nomeExtraido, vendedorId]);
          vendedorNome = nomeExtraido;
          reply = `Prazer, ${nomeExtraido}! 🎯\n\nAgora é só me mandar o pedido que eu monto o orçamento. Lembre de informar o nome do cliente também.`;
        } else {
          reply = 'Não consegui identificar seu nome. Pode me mandar só o nome, por favor? (ex: "João Silva")';
        }
      }

      await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
      return;
    }

    // Ações pendentes (state machine de confirmações e seleções)
    const { rows: pendRows } = await pool.query(
      `SELECT acao_pendente FROM sessoes WHERE id = $1`,
      [currentSessionId]
    );
    const acaoPendente: any = pendRows[0]?.acao_pendente || null;

    // 1. Seleção de cliente para finalizar/alterar orçamento
    if (acaoPendente && acaoPendente.tipo === 'selecionar_cliente') {
      const candidatos: ClienteMatch[] = Array.isArray(acaoPendente.candidatos) ? acaoPendente.candidatos : [];
      const escolha = parseEscolha(incomingText, candidatos.length);
      await gravarMensagem(currentSessionId!, vendedorId, 'user', incomingText, tipoMidia);

      if (escolha.kind === 'cancela') {
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          'Ok, cancelei a finalização. Os itens estão aí — me passe o cliente certo quando quiser fechar.');
        return;
      }

      if (escolha.kind === 'novo') {
        const nomeNovo = String(acaoPendente.nome_sugerido || '').trim();
        if (!nomeNovo) {
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            'Pra cadastrar o novo cliente, me manda o nome dele.');
          return;
        }
        const { rows: novoRows } = await pool.query(
          `INSERT INTO clientes (nome) VALUES ($1) RETURNING id, nome`,
          [nomeNovo]
        );
        const novo = novoRows[0];
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        await gravarOrcamento({
          fnName: acaoPendente.fn,
          vendedorId,
          currentSessionId: currentSessionId!,
          senderNumber,
          itens: acaoPendente.itens || [],
          total: Number(acaoPendente.total || 0),
          clienteId: novo.id,
          clienteNome: novo.nome,
          numeroAlvo: acaoPendente.numero_alvo || null,
        });
        return;
      }

      if (escolha.kind === 'numero') {
        const c = candidatos[escolha.idx];
        if (!c) {
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            `Opção inválida. Escolha um número de 1 a ${candidatos.length}, *novo* ou *cancela*.`);
          return;
        }
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        // Cliente já escolhido — vai DIRETO para gravarOrcamento (sem refazer a busca)
        await gravarOrcamento({
          fnName: acaoPendente.fn,
          vendedorId,
          currentSessionId: currentSessionId!,
          senderNumber,
          itens: acaoPendente.itens || [],
          total: Number(acaoPendente.total || 0),
          clienteId: c.id,
          clienteNome: c.nome,
          numeroAlvo: acaoPendente.numero_alvo || null,
        });
        return;
      }

      const reply = candidatos.length === 0
        ? `Não entendi. Responda *novo* para cadastrar "${acaoPendente.nome_sugerido}" como novo cliente, ou *cancela*.`
        : `Não entendi sua escolha. Responda com o *número* (1 a ${candidatos.length}), *novo* pra cadastrar um novo cliente, ou *cancela*.`;
      await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
      return;
    }

    // 2. Seleção de cliente para EDITAR
    if (acaoPendente && acaoPendente.tipo === 'selecionar_cliente_edicao') {
      const candidatos: ClienteMatch[] = Array.isArray(acaoPendente.candidatos) ? acaoPendente.candidatos : [];
      const escolha = parseEscolha(incomingText, candidatos.length);
      await gravarMensagem(currentSessionId!, vendedorId, 'user', incomingText, tipoMidia);

      if (escolha.kind === 'cancela' || escolha.kind === 'novo') {
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        await replyAndLog(senderNumber, currentSessionId!, vendedorId, 'Ok, cancelei a edição.');
        return;
      }
      if (escolha.kind === 'numero') {
        const c = candidatos[escolha.idx];
        if (!c) {
          await sendWhatsAppMessage(senderNumber, `Opção inválida. Escolha um número de 1 a ${candidatos.length} ou *cancela*.`);
          return;
        }
        const campos = acaoPendente.campos || {};
        const fields = Object.keys(campos).filter(k => campos[k] !== undefined && campos[k] !== null && campos[k] !== '');
        if (fields.length === 0) {
          await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
          await sendWhatsAppMessage(senderNumber, 'Não tinha campo para alterar. Me diga o que mudar.');
          return;
        }
        const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
        const values = fields.map(f => campos[f]);
        values.push(c.id);
        await pool.query(
          `UPDATE clientes SET ${sets}, atualizado_em = NOW() WHERE id = $${values.length}`,
          values
        );
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        const detalhes = fields.map(f => `${f}: ${campos[f]}`).join('\n');
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `✏️ Cliente *${c.nome}* atualizado:\n\n${detalhes}`);
        return;
      }
      await sendWhatsAppMessage(senderNumber,
        `Não entendi. Responda com o *número* (1 a ${candidatos.length}) do cliente que você quer alterar, ou *cancela*.`);
      return;
    }

    // 3. Confirmação clássica (fechar venda / cancelar orçamento)
    if (acaoPendente && acaoPendente.tipo && acaoPendente.numero) {
      const conf = parseConfirmacao(incomingText);
      if (conf === 'sim' || conf === 'nao') {
        await gravarMensagem(currentSessionId!, vendedorId, 'user', incomingText, tipoMidia);

        let reply: string;
        if (conf === 'sim') {
          if (acaoPendente.tipo === 'fechar_venda') {
            const { rowCount } = await pool.query(
              `UPDATE orcamentos SET status = 'venda', atualizado_em = NOW()
               WHERE numero = $1 AND vendedor_id = $2 AND status = 'aberto'`,
              [acaoPendente.numero, vendedorId]
            );
            reply = (rowCount ?? 0) > 0
              ? `✅ *${acaoPendente.numero}* marcado como VENDA. 🎉`
              : `Não consegui fechar o ${acaoPendente.numero} — talvez já tenha sido fechado ou cancelado.`;
          } else if (acaoPendente.tipo === 'cancelar') {
            const { rowCount } = await pool.query(
              `UPDATE orcamentos SET status = 'cancelado', atualizado_em = NOW()
               WHERE numero = $1 AND vendedor_id = $2 AND status = 'aberto'`,
              [acaoPendente.numero, vendedorId]
            );
            reply = (rowCount ?? 0) > 0
              ? `🚫 *${acaoPendente.numero}* cancelado.`
              : `Não consegui cancelar o ${acaoPendente.numero} — talvez já tenha sido fechado ou cancelado.`;
          } else {
            reply = 'Ação não reconhecida.';
          }
        } else {
          reply = `Ok, mantive o *${acaoPendente.numero}* como está. 👍`;
        }
        await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
        await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
        return;
      }
      // Ambíguo: limpa pendente e segue o fluxo normal (vendedor mudou de assunto)
      await pool.query(`UPDATE sessoes SET acao_pendente = NULL WHERE id = $1`, [currentSessionId]);
    }

    // Extrator: gpt-4.1 JSON strict, temperature 0
    const { rows: historicoRows } = await pool.query(
      `SELECT papel as role, conteudo FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em ASC`,
      [currentSessionId]
    );

    let historyMessages: any[] = historicoRows.map(row => ({
      role: row.role,
      content: row.conteudo,
    }));

    const extractResponse = await chatComplete({
      model: 'gpt-4.1',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXTRACT_INTENT_PROMPT },
        ...historyMessages,
        { role: 'user', content: incomingText },
      ],
    }, { vendedorId, sessaoId: currentSessionId, purpose: 'extract' });

    const rawExtract = extractResponse.choices[0].message.content || '{}';
    let parsedExtract: {
      intent?: string;
      new_session?: boolean;
      ref_numero?: string | null;
      cliente_busca?: string | null;
      terms?: string[];
    } = {};
    try {
      parsedExtract = JSON.parse(rawExtract);
    } catch {
      logger.error('extract JSON parse failed', { raw: rawExtract });
    }
    const intent = (parsedExtract.intent as string) || 'pedido';
    const newSession = parsedExtract.new_session === true;
    const refNumero = parsedExtract.ref_numero ? String(parsedExtract.ref_numero).trim() : null;
    const clienteBusca = parsedExtract.cliente_busca ? String(parsedExtract.cliente_busca).trim() : null;
    const extractedTerms = Array.isArray(parsedExtract.terms) ? parsedExtract.terms : [];
    logger.info('extract', { incomingText, intent, newSession, refNumero, clienteBusca, extractedTerms });

    if (newSession) {
      await pool.query(`UPDATE sessoes SET status = 'encerrada', encerrada_em = NOW() WHERE id = $1`, [currentSessionId]);
      const { rows: newSessionRows } = await pool.query(
        `INSERT INTO sessoes (vendedor_id) VALUES ($1) RETURNING id`,
        [vendedorId]
      );
      currentSessionId = newSessionRows[0].id;
      historyMessages = [];
    }

    await gravarMensagem(currentSessionId!, vendedorId, 'user', incomingText, tipoMidia);
    historyMessages.push({ role: 'user', content: incomingText });

    // Roteamento determinístico para intents administrativas

    if (intent === 'listar_abertos') {
      const { rows: abertos } = await pool.query(
        `SELECT numero, cliente_nome, total, criado_em FROM orcamentos
         WHERE vendedor_id = $1 AND status = 'aberto'
         ORDER BY criado_em DESC LIMIT 30`,
        [vendedorId]
      );
      const reply = abertos.length === 0
        ? `Você não tem orçamentos em aberto no momento, ${vendedorNome}. 👍`
        : `Seus orçamentos em aberto (${abertos.length}):\n\n` +
          abertos.map((o, i) =>
            `${i + 1}. *${o.numero}* — ${o.cliente_nome || 'sem cliente'} — R$ ${fmtBR(o.total)}`
          ).join('\n') +
          `\n\nPara fechar como venda, mande: "fechei o ${abertos[0].numero}". Para cancelar: "cancela o ${abertos[0].numero}".`;
      await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
      return;
    }

    if (intent === 'buscar_por_cliente') {
      if (!clienteBusca) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          'Qual o nome do cliente que você quer buscar?');
        return;
      }
      const { rows: matches } = await pool.query(
        `SELECT numero, cliente_nome, total, status, criado_em FROM orcamentos
         WHERE vendedor_id = $1 AND unaccent(lower(cliente_nome)) LIKE unaccent(lower($2))
         ORDER BY criado_em DESC LIMIT 30`,
        [vendedorId, `%${clienteBusca}%`]
      );
      const statusLabel: Record<string, string> = {
        aberto: '🟡 aberto',
        venda: '✅ venda',
        cancelado: '🚫 cancelado',
      };
      const reply = matches.length === 0
        ? `Não encontrei orçamentos para "${clienteBusca}".`
        : `Orçamentos de "${clienteBusca}" (${matches.length}):\n\n` +
          matches.map((o, i) =>
            `${i + 1}. *${o.numero}* — ${o.cliente_nome} — R$ ${fmtBR(o.total)} — ${statusLabel[o.status] || o.status}`
          ).join('\n');
      await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
      return;
    }

    if (intent === 'fechar_venda' || intent === 'cancelar_orcamento') {
      const numeroNorm = normalizarNumeroOrcamento(refNumero);
      if (!numeroNorm) {
        const reply = intent === 'fechar_venda'
          ? 'Qual orçamento você quer fechar como venda? (ex: "fechei o ORC-000123")'
          : 'Qual orçamento você quer cancelar? (ex: "cancela o ORC-000123")';
        await replyAndLog(senderNumber, currentSessionId!, vendedorId, reply);
        return;
      }
      const { rows: orcRows } = await pool.query(
        `SELECT numero, cliente_nome, total, status FROM orcamentos
         WHERE numero = $1 AND vendedor_id = $2`,
        [numeroNorm, vendedorId]
      );
      if (orcRows.length === 0) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `Não achei o ${numeroNorm} nos seus orçamentos. Confira o número.`);
        return;
      }
      const orc = orcRows[0];
      if (orc.status !== 'aberto') {
        const statusTxt = orc.status === 'venda' ? 'fechado como venda' : 'cancelado';
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `O ${numeroNorm} já está ${statusTxt}. Nada a fazer.`);
        return;
      }
      const tipoAcao = intent === 'fechar_venda' ? 'fechar_venda' : 'cancelar';
      await pool.query(
        `UPDATE sessoes SET acao_pendente = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ tipo: tipoAcao, numero: numeroNorm }), currentSessionId]
      );
      const verbo = intent === 'fechar_venda' ? 'fechar como *VENDA*' : 'cancelar';
      await replyAndLog(senderNumber, currentSessionId!, vendedorId,
        `Confirma ${verbo} o *${numeroNorm}*?\n\nCliente: ${orc.cliente_nome || '—'}\nTotal: R$ ${fmtBR(orc.total)}\n\nResponda *sim* ou *não*.`);
      return;
    }

    // Modo alteração: carrega orçamento alvo e valida
    let orcamentoEmAlteracao: OrcamentoEmAlteracao | null = null;

    if (intent === 'alterar_orcamento') {
      const numeroNorm = normalizarNumeroOrcamento(refNumero);
      if (!numeroNorm) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          'Qual orçamento você quer alterar? Me passa o número (ex: "ORC-000123").');
        return;
      }
      const { rows: orcRows } = await pool.query(
        `SELECT numero, cliente_nome, itens, total, status FROM orcamentos
         WHERE numero = $1 AND vendedor_id = $2`,
        [numeroNorm, vendedorId]
      );
      if (orcRows.length === 0) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `Não achei o ${numeroNorm} nos seus orçamentos.`);
        return;
      }
      if (orcRows[0].status !== 'aberto') {
        const statusTxt = orcRows[0].status === 'venda' ? 'fechado como venda' : 'cancelado';
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `Não dá pra alterar o ${numeroNorm} — ele já está ${statusTxt}.`);
        return;
      }
      orcamentoEmAlteracao = {
        numero: orcRows[0].numero,
        cliente_nome: orcRows[0].cliente_nome,
        itens: orcRows[0].itens || [],
        total: Number(orcRows[0].total),
      };
    }

    const termsToSearch = extractedTerms
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length > 2);

    const groupedResults = await searchProducts(termsToSearch);

    // Flat dedupe (mantido por compat, mas hoje só o grouped vai pro prompt)
    const seen = new Set<number>();
    const searchResults: any[] = [];
    for (const g of groupedResults) {
      for (const p of g.products) {
        if (!seen.has(p.id)) { seen.add(p.id); searchResults.push(p); }
      }
    }

    logger.info('search', { terms: termsToSearch, found: searchResults.length });

    const stockContext = buildStockContext(groupedResults);
    const alteracaoBlock = buildAlteracaoBlock(orcamentoEmAlteracao);
    const finalPrompt = buildFinalPrompt({
      corePrompt: config.core_prompt,
      stockContext,
      alteracaoBlock,
    });

    const finalResponse = await chatComplete({
      model: 'gpt-4.1',
      messages: [
        { role: 'system', content: finalPrompt },
        ...historyMessages,
      ],
      tools,
    }, { vendedorId, sessaoId: currentSessionId, purpose: 'final' });

    const choice = finalResponse.choices[0].message;
    const toolCall = choice.tool_calls?.find(
      (tc: any) => tc?.type === 'function' && SUPPORTED_FN_NAMES.has(tc?.function?.name)
    ) as any;

    if (toolCall) {
      const fnName = toolCall.function?.name as
        'finalizar_orcamento' | 'alterar_orcamento' | 'cadastrar_cliente' | 'editar_cliente';
      let args: any = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch {
        logger.error('tool args JSON parse failed', { fnName, arguments: toolCall.function?.arguments });
      }

      // Cadastrar cliente (fora do fluxo de orçamento)
      if (fnName === 'cadastrar_cliente') {
        const nome = typeof args.nome === 'string' ? args.nome.trim() : '';
        if (!nome) {
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            'Pra cadastrar o cliente preciso pelo menos do nome.');
          return;
        }
        const allowedFields = [
          'nome','fantasia','tipo_pessoa','cpf_cnpj','fone','celular','email',
          'endereco','numero','complemento','bairro','cidade','uf','cep','tipo_contato',
        ];
        const cols: string[] = [];
        const placeholders: string[] = [];
        const values: any[] = [];
        for (const f of allowedFields) {
          if (args[f] !== undefined && args[f] !== null && String(args[f]).trim() !== '') {
            cols.push(f);
            placeholders.push(`$${values.length + 1}`);
            values.push(String(args[f]).trim());
          }
        }
        if (!cols.includes('nome')) {
          cols.unshift('nome');
          placeholders.unshift(`$${values.length + 1}`);
          values.push(nome);
        }
        const { rows: insRows } = await pool.query(
          `INSERT INTO clientes (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, nome, cpf_cnpj, cidade, uf`,
          values
        );
        const novo = insRows[0];
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `✅ Cliente cadastrado:\n\n*${novo.nome}*${novo.cpf_cnpj ? `\nCPF/CNPJ: ${novo.cpf_cnpj}` : ''}${novo.cidade ? `\n${novo.cidade}${novo.uf ? '/' + novo.uf : ''}` : ''}`);
        return;
      }

      // Editar cliente
      if (fnName === 'editar_cliente') {
        const query = typeof args.query === 'string' ? args.query.trim() : '';
        const campos = (args.campos && typeof args.campos === 'object') ? args.campos : {};
        const camposLimpos: Record<string, string> = {};
        for (const [k, v] of Object.entries(campos)) {
          if (typeof v === 'string' && v.trim() !== '') camposLimpos[k] = v.trim();
        }
        if (!query || Object.keys(camposLimpos).length === 0) {
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            'Pra editar um cliente preciso de: identificador (nome/CPF/ID) e os campos a alterar.');
          return;
        }
        const matches = await searchClientes(query, 5);
        if (matches.length === 0) {
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            `Não achei nenhum cliente parecido com "${query}". Confira o nome/CPF.`);
          return;
        }
        const isMatchForte = (m: ClienteMatch) =>
          m.match_type === 'documento' || m.match_type === 'externo_id' ||
          (m.match_type === 'fuzzy' && m.score >= 0.7);

        if (matches.length === 1 && isMatchForte(matches[0])) {
          const c = matches[0];
          const fields = Object.keys(camposLimpos);
          const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
          const values = fields.map(f => camposLimpos[f]);
          values.push(c.id);
          await pool.query(
            `UPDATE clientes SET ${sets}, atualizado_em = NOW() WHERE id = $${values.length}`,
            values
          );
          const detalhes = fields.map(f => `${f}: ${camposLimpos[f]}`).join('\n');
          await replyAndLog(senderNumber, currentSessionId!, vendedorId,
            `✏️ Cliente *${c.nome}* atualizado:\n\n${detalhes}`);
          return;
        }
        await pool.query(
          `UPDATE sessoes SET acao_pendente = $1::jsonb WHERE id = $2`,
          [JSON.stringify({
            tipo: 'selecionar_cliente_edicao',
            candidatos: matches,
            campos: camposLimpos,
          }), currentSessionId]
        );
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          `Achei ${matches.length} cliente${matches.length > 1 ? 's' : ''} para "${query}":\n\n${formatListaClientes(matches)}\n\nQual deles você quer alterar? Responda com o *número* ou *cancela*.`);
        return;
      }

      // Finalizar / alterar orçamento
      const itens = Array.isArray(args.itens) ? args.itens : [];
      const total = Number(args.total ?? 0);
      const clienteNome = typeof args.cliente_nome === 'string' && args.cliente_nome.trim().length > 0
        ? args.cliente_nome.trim()
        : null;

      if (itens.length === 0 || !(total > 0)) {
        logger.error('orçamento args inválidos', { fnName, args });
        return;
      }

      if (!clienteNome) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId,
          'Antes de fechar, preciso do nome do cliente para esse orçamento. Para quem é? 👤');
        return;
      }

      const numeroAlvo = fnName === 'alterar_orcamento'
        ? (orcamentoEmAlteracao?.numero || normalizarNumeroOrcamento(String(args.numero || '')))
        : null;

      await resolverClienteEGravar({
        fnName, vendedorId, currentSessionId: currentSessionId!, senderNumber,
        itens, total,
        clienteQuery: clienteNome,
        numeroAlvo,
      });
    } else {
      const replyText = choice.content;
      if (replyText) {
        await replyAndLog(senderNumber, currentSessionId!, vendedorId, replyText);
      }
    }
  } catch (err: any) {
    logger.error('webhook error', { err: err?.message, stack: err?.stack });
  } finally {
    ack(res);
  }
});
