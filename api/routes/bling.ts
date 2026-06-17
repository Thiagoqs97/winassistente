import { Router } from 'express';
import { randomBytes } from 'crypto';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';
import {
  getAuthorizeUrl,
  exchangeCode,
  getConnectionStatus,
  iterateProdutos,
  getProdutoDetalhe,
  extrairSaldo,
  verifyBlingSignature,
  type BlingProduto,
} from '../services/bling.js';
import {
  diagnosticoBling,
  mapearProdutos,
  syncImagensBatch,
  syncEstoqueBatch,
  aplicarEstoqueWebhook,
  type DiagnosticoResult,
} from '../services/bling-sync.js';

export const blingRouter = Router();

const STATE_COOKIE = 'bling_oauth_state';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

function page(titulo: string, corpo: string, headExtra = ''): string {
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${titulo}</title>${headExtra}
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:40px;line-height:1.5}
.card{max-width:760px;margin:0 auto;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px}
h1{margin:0 0 12px;font-size:22px}h2{font-size:16px;margin:24px 0 8px}a{color:#818cf8}
table{border-collapse:collapse;width:100%;margin-top:12px}td,th{padding:8px 10px;border-bottom:1px solid #334155;text-align:left;font-size:14px}
.big{font-size:34px;font-weight:700;margin:4px 0}.muted{color:#94a3b8}.ok{color:#4ade80}</style></head>
<body><div class="card">${corpo}</div></body></html>`;
}

// 1) Inicia o OAuth: gera state, salva em cookie httpOnly e redireciona pro Bling.
blingRouter.get('/bling/authorize', requireAuth, requireRole('admin'), (_req: AuthRequest, res) => {
  if (!process.env.BLING_CLIENT_ID) {
    res.status(500).send(page('Erro', '<h1>BLING_CLIENT_ID não configurado no ambiente</h1>'));
    return;
  }
  const state = randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(getAuthorizeUrl(state));
});

// 2) Callback PÚBLICO — o Bling redireciona o navegador pra cá com ?code & ?state.
//    Protegido por comparação do state com o cookie (CSRF).
blingRouter.get('/bling/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const expected = (req as { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE];
  if (!code) {
    res.status(400).send(page('Erro', '<h1>Faltou o parâmetro <code>code</code></h1>'));
    return;
  }
  if (!expected || state !== expected) {
    res.status(400).send(page('Erro de segurança', '<h1>O <code>state</code> não confere</h1><p>Conecte de novo pelo painel.</p>'));
    return;
  }
  try {
    await exchangeCode(code);
    res.clearCookie(STATE_COOKIE);
    res.send(page('Bling conectado', '<h1 class="ok">Bling conectado ✓</h1><p>Pode fechar esta aba e voltar ao painel.</p>'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao trocar o código por token.';
    logger.error('Bling callback erro', { err: msg });
    res.status(500).send(page('Falhou', `<h1>Não consegui conectar</h1><p class="muted">${escapeHtml(msg)}</p>`));
  }
});

// Webhook PÚBLICO — o Bling chama aqui quando o estoque muda (venda, lançamento).
// Não passa por auth do painel: a legitimidade vem da assinatura HMAC sobre o
// corpo CRU (req.rawBody, capturado no express.json do server). Atualiza só o
// produto que mudou → tempo real, sem varrer o catálogo inteiro. O Bling exige
// resposta 2xx em até 5s e reenvia por até 3 dias em caso de falha; por isso
// respondemos rápido e tratamos tudo como idempotente.
blingRouter.post('/bling/webhook', async (req: AuthRequest, res) => {
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const sig = req.header('x-bling-signature-256');
  if (!rawBody || !verifyBlingSignature(rawBody, sig)) {
    res.status(401).json({ error: 'assinatura inválida' });
    return;
  }
  try {
    const body = req.body as { event?: string; data?: unknown };
    const event = typeof body.event === 'string' ? body.event : '';
    // stock = lançamento físico; virtual_stock = reserva de venda/composição.
    if ((event.startsWith('stock.') || event.startsWith('virtual_stock.')) && body.data) {
      const r = await aplicarEstoqueWebhook(body.data);
      logger.info('Bling webhook estoque', { event, ...r });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    // Ack mesmo no erro: 200 evita os 3 dias de retry do Bling por uma falha
    // pontual nossa (o sync agendado/manual reconcilia depois se preciso).
    logger.error('Bling webhook erro', { err: err instanceof Error ? err.message : String(err) });
    res.status(200).json({ ok: true });
  }
});

blingRouter.get('/bling/status', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await getConnectionStatus());
  } catch {
    res.status(500).json({ error: 'Erro ao consultar status do Bling' });
  }
});

// Inspetor pra confirmar onde vem a imagem:
//  - ?sku=XXX  -> detalhe cru do produto com aquele código no Bling
//  - sem param -> varre os primeiros ~120 e devolve o 1º COM imagem (e quantos
//                 dos varridos tinham foto, pra dar uma ideia do hit-rate)
blingRouter.get('/bling/sample', requireAuth, requireRole('admin'), async (req, res) => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  try {
    const sku = typeof req.query.sku === 'string' ? req.query.sku.trim() : '';

    if (sku) {
      let found: BlingProduto | null = null;
      for await (const p of iterateProdutos()) {
        if ((p.codigo ?? '').trim() === sku) {
          found = p;
          break;
        }
      }
      if (!found) {
        res.json({ erro: `SKU ${sku} não encontrado no Bling` });
        return;
      }
      const detalhe = await getProdutoDetalhe(found.id);
      // saldo + estoque cru em destaque pra confirmar scope/shape antes do sync.
      res.json({
        blingId: found.id,
        codigo: found.codigo,
        nome: found.nome,
        saldo: extrairSaldo(detalhe),
        estoque: detalhe.data?.estoque ?? null,
        detalhe,
      });
      return;
    }

    let scanned = 0;
    let comImagem = 0;
    let exemplo: unknown = null;
    for await (const p of iterateProdutos()) {
      scanned++;
      const d = await getProdutoDetalhe(p.id);
      const imgs = d.data?.midia?.imagens;
      const tem = (imgs?.externas?.length ?? 0) + (imgs?.internas?.length ?? 0) + (imgs?.imagensURL?.length ?? 0) > 0;
      if (tem) {
        comImagem++;
        if (!exemplo) exemplo = { blingId: p.id, codigo: p.codigo, nome: p.nome, midia: d.data?.midia };
      }
      if (scanned >= 120) break;
      await sleep(350);
    }
    res.json({ scanned, comImagem, exemplo });
  } catch (err) {
    res.status(500).json({ erro: err instanceof Error ? err.message : 'erro' });
  }
});

// 3) Diagnóstico (dry-run): mede o casamento, NÃO baixa imagem nenhuma.
//    ?format=json devolve os dados; ?format=csv baixa a lista de faltantes.
blingRouter.get('/bling/diagnostico', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const r = await diagnosticoBling();
    const format = typeof req.query.format === 'string' ? req.query.format : 'html';

    if (format === 'json') {
      res.json(r);
      return;
    }
    if (format === 'csv') {
      const linhas = ['id,codigo,descricao'];
      for (const f of r.faltantes) {
        const codigo = (f.codigo ?? '').replace(/"/g, '""');
        const descricao = f.descricao.replace(/"/g, '""');
        linhas.push(`${f.id},"${codigo}","${descricao}"`);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="bling-faltantes.csv"');
      res.send('﻿' + linhas.join('\r\n')); // BOM p/ Excel abrir acento certo
      return;
    }
    res.send(renderReport(r));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    logger.error('Bling diagnóstico erro', { err: msg });
    res.status(500).send(page('Erro no diagnóstico', `<h1>Falhou</h1><p class="muted">${escapeHtml(msg)}</p>`));
  }
});

// 4) Mapeamento: grava products.bling_id pros que casam (roda uma vez).
blingRouter.get('/bling/mapear', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    res.json(await mapearProdutos());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    logger.error('Bling mapear erro', { err: msg });
    res.status(500).json({ erro: msg });
  }
});

// 5) Sync de imagens em lote. Roda ~3,5min por requisição e se auto-recarrega
//    (meta refresh) ate terminar — e so deixar a aba aberta.
blingRouter.get('/bling/sync-imagens', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const r = await syncImagensBatch();
    const headExtra = r.done ? '' : '<meta http-equiv="refresh" content="3">';
    const status = r.done
      ? '<h1 class="ok">Sync concluído ✓</h1>'
      : '<h1>Sincronizando imagens… <span class="muted" style="font-size:14px">(recarrega sozinho)</span></h1>';
    const corpo = `${status}
      <table>
        <tr><th>Processados neste lote</th><td>${r.processed}</td></tr>
        <tr><th>Com foto baixada</th><td class="ok">${r.comFoto}</td></tr>
        <tr><th>Sem foto no Bling</th><td>${r.semFoto}</td></tr>
        <tr><th>Faltam processar</th><td>${r.restantes}</td></tr>
      </table>
      ${r.done ? '<p style="margin-top:16px">Pode fechar esta aba.</p>' : '<p class="muted" style="margin-top:16px">Não feche a aba até zerar os restantes.</p>'}`;
    res.send(page('Sync de imagens — Bling', corpo, headExtra));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    logger.error('Bling sync-imagens erro', { err: msg });
    res.status(500).send(page('Erro no sync', `<h1>Falhou</h1><p class="muted">${escapeHtml(msg)}</p>`));
  }
});

// 6) Sync de estoque em lote. Igual ao de imagens: roda ~3,5min por requisição
//    e se auto-recarrega (meta refresh) até zerar os restantes. Pode rodar de
//    novo a qualquer momento pra atualizar os saldos (re-sincroniza tudo).
blingRouter.get('/bling/sync-estoque', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const r = await syncEstoqueBatch();
    const headExtra = r.done ? '' : '<meta http-equiv="refresh" content="3">';
    // Sinaliza o caso "rodou mas o Bling não devolveu saldo nenhum" (scope faltando):
    // tudo caiu em semInfo e houve erro de lote → não é sucesso de verdade.
    const semSaldoNenhum = r.disponiveis === 0 && r.esgotados === 0 && r.semInfo > 0;
    const status = !r.done
      ? '<h1>Sincronizando estoque… <span class="muted" style="font-size:14px">(recarrega sozinho)</span></h1>'
      : semSaldoNenhum
        ? '<h1>Sync rodou, mas o Bling não devolveu saldo ⚠️</h1>'
        : '<h1 class="ok">Sync de estoque concluído ✓</h1>';
    const avisoErro = r.ultimoErro
      ? `<p class="muted" style="margin-top:8px;color:#fbbf24">Erro do Bling: <b>${escapeHtml(r.ultimoErro)}</b>${
          r.ultimoErro.includes('insufficient_scope') || r.ultimoErro.includes('403')
            ? ' — o app não tem permissão de <b>Estoques</b>. Habilite o escopo no cadastro do app no Bling e reconecte pelo painel.'
            : ''
        }</p>`
      : '';
    const corpo = `${status}${avisoErro}
      <table>
        <tr><th>Processados neste lote</th><td>${r.processed}</td></tr>
        <tr><th>Disponíveis (saldo &gt; 0)</th><td class="ok">${r.disponiveis}</td></tr>
        <tr><th>Sem estoque (saldo ≤ 0)</th><td>${r.esgotados}</td></tr>
        <tr><th>Sem saldo informado pelo Bling</th><td class="muted">${r.semInfo}</td></tr>
        <tr><th>Faltam processar</th><td>${r.restantes}</td></tr>
      </table>
      ${r.done ? '<p style="margin-top:16px">Pode fechar esta aba.</p>' : '<p class="muted" style="margin-top:16px">Não feche a aba até zerar os restantes.</p>'}`;
    res.send(page('Sync de estoque — Bling', corpo, headExtra));
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    logger.error('Bling sync-estoque erro', { err: msg });
    res.status(500).send(page('Erro no sync', `<h1>Falhou</h1><p class="muted">${escapeHtml(msg)}</p>`));
  }
});

function renderReport(r: DiagnosticoResult): string {
  const pct = r.ourTotal ? Math.round((r.matchedTotal / r.ourTotal) * 100) : 0;
  const amostra = r.faltantes
    .slice(0, 50)
    .map((f) => `<tr><td class="muted">${escapeHtml(f.codigo ?? '--')}</td><td>${escapeHtml(f.descricao)}</td></tr>`)
    .join('');
  return page(
    'Diagnóstico Bling',
    `<h1>Diagnóstico de casamento — Bling</h1>
     <div class="big ok">${r.matchedTotal} <span class="muted" style="font-size:16px">de ${r.ourTotal} (${pct}%) com match seguro</span></div>
     <table>
       <tr><th>Produtos no nosso sistema (ativos)</th><td>${r.ourTotal}</td></tr>
       <tr><th>Produtos no Bling</th><td>${r.blingTotal}</td></tr>
       <tr><th>Match por código (SKU)</th><td>${r.matchedBySku}</td></tr>
       <tr><th>Match por nome exato</th><td>${r.matchedByName}</td></tr>
       <tr><th>Sem match seguro (faltantes)</th><td>${r.faltantes.length}</td></tr>
     </table>
     <p style="margin-top:18px"><a href="/api/bling/diagnostico?format=csv">⬇️ Baixar CSV dos ${r.faltantes.length} faltantes</a> &nbsp;·&nbsp; <a href="/api/bling/diagnostico?format=json">ver JSON</a></p>
     <h2>Amostra dos faltantes (até 50)</h2>
     <table><tr><th>Código</th><th>Descrição</th></tr>${amostra}</table>`,
  );
}
