import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { requireCliente, type ClienteRequest } from '../middleware/cliente-auth.js';
import {
  listarProdutosLoja,
  listarCategoriasLoja,
  listarMarcasLoja,
  criarPedidoCatalogo,
  PedidoInvalidoError,
} from '../services/loja.js';
import {
  criarAvisoEstoque,
  cancelarAvisoEstoque,
  AvisoEstoqueError,
} from '../services/avisos-estoque.js';

// Router PÚBLICO do catálogo (sem auth). Tem que ser montado ANTES dos routers
// do painel no server.ts — vários deles fazem router.use(requireAuth), que
// dispara pra qualquer request que cai no router e devolveria 401 aqui.
export const lojaRouter = Router();

// Rate-limit best-effort por IP só pro POST de pedido. Em serverless é
// por-instância (não compartilhado), então é defesa-em-profundidade, não
// garantia. A validação forte no service é a real barreira contra lixo.
const HITS = new Map<string, number[]>();
const JANELA_MS = 60_000;
const MAX_POR_JANELA = 8;

function rateLimited(ip: string): boolean {
  const agora = Date.now();
  const recentes = (HITS.get(ip) ?? []).filter((t) => agora - t < JANELA_MS);
  recentes.push(agora);
  HITS.set(ip, recentes);
  return recentes.length > MAX_POR_JANELA;
}

lojaRouter.get('/loja/produtos', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const categoria = typeof req.query.categoria === 'string' ? req.query.categoria : undefined;
    const marca = typeof req.query.marca === 'string' ? req.query.marca : undefined;
    const pagina = req.query.pagina ? parseInt(String(req.query.pagina), 10) : 1;
    const limite = req.query.limite ? parseInt(String(req.query.limite), 10) : 24;
    const out = await listarProdutosLoja({ q, categoria, marca, pagina, limite });
    res.json(out);
  } catch (err: any) {
    logger.error('GET /loja/produtos falhou', { err: err?.message });
    res.status(500).json({ error: 'Erro ao listar produtos.' });
  }
});

// Filtros da vitrine: categorias (com label da taxonomia) e marcas, ambas com
// contagem de cards. Públicas (sem auth), como o resto do /loja.
lojaRouter.get('/loja/categorias', async (_req, res) => {
  try {
    res.json(await listarCategoriasLoja());
  } catch (err: any) {
    logger.error('GET /loja/categorias falhou', { err: err?.message });
    res.status(500).json({ error: 'Erro ao listar categorias.' });
  }
});

lojaRouter.get('/loja/marcas', async (_req, res) => {
  try {
    res.json(await listarMarcasLoja());
  } catch (err: any) {
    logger.error('GET /loja/marcas falhou', { err: err?.message });
    res.status(500).json({ error: 'Erro ao listar marcas.' });
  }
});

// Checkout EXIGE conta (requireCliente): o cliente vem do cookie de sessão, não
// de nome/telefone digitados. requireCliente é guard POR ROTA — não vaza pras
// rotas públicas (GET produtos/categorias/marcas) do mesmo router.
lojaRouter.post('/loja/pedido', requireCliente, async (req: ClienteRequest, res) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'desconhecido';
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
    return;
  }
  try {
    const { itens, enderecoId } = req.body ?? {};
    const resultado = await criarPedidoCatalogo({ clienteId: req.cliente!.id, itens, enderecoId });
    res.status(201).json(resultado);
  } catch (err: any) {
    if (err instanceof PedidoInvalidoError) {
      res.status(400).json({ error: err.message });
      return;
    }
    logger.error('POST /loja/pedido falhou', { err: err?.message });
    res.status(500).json({ error: 'Não consegui registrar o pedido. Tente novamente.' });
  }
});

lojaRouter.post('/loja/produtos/:id/avise-me', requireCliente, async (req: ClienteRequest, res) => {
  try {
    const produtoId = Number(req.params.id);
    const out = await criarAvisoEstoque(req.cliente!.id, produtoId);
    res.status(out.jaExistia ? 200 : 201).json({ ok: true, jaExistia: out.jaExistia });
  } catch (err: any) {
    if (err instanceof AvisoEstoqueError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error('POST /loja/produtos/:id/avise-me falhou', { err: err?.message });
    res.status(500).json({ error: 'Não consegui criar o aviso. Tente novamente.' });
  }
});

lojaRouter.delete('/loja/produtos/:id/avise-me', requireCliente, async (req: ClienteRequest, res) => {
  try {
    await cancelarAvisoEstoque(req.cliente!.id, Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    if (err instanceof AvisoEstoqueError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error('DELETE /loja/produtos/:id/avise-me falhou', { err: err?.message });
    res.status(500).json({ error: 'Não consegui cancelar o aviso. Tente novamente.' });
  }
});
