import { Router, type Response } from 'express';
import { logger } from '../lib/logger.js';
import { CLIENTE_COOKIE_NAME, signClienteToken } from '../lib/cliente-auth.js';
import { requireCliente, type ClienteRequest } from '../middleware/cliente-auth.js';
import {
  registrarCliente,
  loginCliente,
  atualizarPerfil,
  listarPedidosCliente,
  listarEnderecos,
  criarEndereco,
  atualizarEndereco,
  removerEndereco,
  ContaError,
} from '../services/conta.js';
import {
  listarAvisosEstoqueCliente,
  listarProdutoIdsComAvisoPendente,
} from '../services/avisos-estoque.js';

// Router da CONTA DO CLIENTE FINAL (catálogo). Montado na área pública (antes dos
// routers do painel). Login/registro/logout são abertos; o resto exige requireCliente
// POR ROTA — nada de router.use(guard) sem path, que vazaria pros outros routers.
export const contaRouter = Router();

const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function setClienteCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(CLIENTE_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

// Rate-limit best-effort por IP nas rotas sensíveis (login/registro). Em serverless
// é por-instância — defesa em profundidade, não garantia.
const HITS = new Map<string, number[]>();
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 10;
function rateLimited(ip: string): boolean {
  const agora = Date.now();
  const recentes = (HITS.get(ip) ?? []).filter((t) => agora - t < JANELA_MS);
  recentes.push(agora);
  HITS.set(ip, recentes);
  return recentes.length > MAX_POR_JANELA;
}
function ipDe(req: any): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'desconhecido';
}

function tratarErro(res: Response, err: any, contexto: string) {
  if (err instanceof ContaError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error(contexto, { err: err?.message });
  res.status(500).json({ error: 'Algo deu errado. Tente de novo.' });
}

contaRouter.post('/conta/registrar', async (req, res) => {
  if (rateLimited(ipDe(req))) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    return;
  }
  try {
    const { nome, email, senha, telefone, cpf_cnpj } = req.body ?? {};
    const { id, cliente } = await registrarCliente({ nome, email, senha, telefone, cpf_cnpj });
    setClienteCookie(res, signClienteToken(id));
    res.status(201).json({ cliente });
  } catch (err) {
    tratarErro(res, err, 'POST /conta/registrar falhou');
  }
});

contaRouter.post('/conta/login', async (req, res) => {
  if (rateLimited(ipDe(req))) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto.' });
    return;
  }
  try {
    const { email, senha } = req.body ?? {};
    const { id, cliente } = await loginCliente(email, senha);
    setClienteCookie(res, signClienteToken(id));
    res.json({ cliente });
  } catch (err) {
    tratarErro(res, err, 'POST /conta/login falhou');
  }
});

contaRouter.post('/conta/logout', (_req, res) => {
  res.clearCookie(CLIENTE_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

contaRouter.get('/conta/me', requireCliente, (req: ClienteRequest, res) => {
  res.json({ cliente: req.cliente });
});

contaRouter.patch('/conta/perfil', requireCliente, async (req: ClienteRequest, res) => {
  try {
    const cliente = await atualizarPerfil(req.cliente!.id, req.body ?? {});
    res.json({ cliente });
  } catch (err) {
    tratarErro(res, err, 'PATCH /conta/perfil falhou');
  }
});

contaRouter.get('/conta/pedidos', requireCliente, async (req: ClienteRequest, res) => {
  try {
    res.json({ pedidos: await listarPedidosCliente(req.cliente!.id) });
  } catch (err) {
    tratarErro(res, err, 'GET /conta/pedidos falhou');
  }
});

contaRouter.get('/conta/avisos', requireCliente, async (req: ClienteRequest, res) => {
  try {
    const somenteIds = req.query.ids === '1';
    if (somenteIds) {
      res.json({ produtoIds: await listarProdutoIdsComAvisoPendente(req.cliente!.id) });
      return;
    }
    res.json({ avisos: await listarAvisosEstoqueCliente(req.cliente!.id) });
  } catch (err) {
    tratarErro(res, err, 'GET /conta/avisos falhou');
  }
});

contaRouter.get('/conta/enderecos', requireCliente, async (req: ClienteRequest, res) => {
  try {
    res.json({ enderecos: await listarEnderecos(req.cliente!.id) });
  } catch (err) {
    tratarErro(res, err, 'GET /conta/enderecos falhou');
  }
});

contaRouter.post('/conta/enderecos', requireCliente, async (req: ClienteRequest, res) => {
  try {
    res.status(201).json({ endereco: await criarEndereco(req.cliente!.id, req.body ?? {}) });
  } catch (err) {
    tratarErro(res, err, 'POST /conta/enderecos falhou');
  }
});

contaRouter.patch('/conta/enderecos/:id', requireCliente, async (req: ClienteRequest, res) => {
  try {
    res.json({ endereco: await atualizarEndereco(req.cliente!.id, req.params.id, req.body ?? {}) });
  } catch (err) {
    tratarErro(res, err, 'PATCH /conta/enderecos/:id falhou');
  }
});

contaRouter.delete('/conta/enderecos/:id', requireCliente, async (req: ClienteRequest, res) => {
  try {
    await removerEndereco(req.cliente!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    tratarErro(res, err, 'DELETE /conta/enderecos/:id falhou');
  }
});
