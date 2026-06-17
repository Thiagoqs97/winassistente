import 'dotenv/config';
import express from 'express';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { ensureDB } from './db/migrations.js';
import { logger } from './lib/logger.js';

import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { productsRouter } from './routes/products.js';
import { clientesRouter } from './routes/clientes.js';
import { orcamentosRouter } from './routes/orcamentos.js';
import { negociosRouter } from './routes/negocios.js';
import { vendedoresRouter } from './routes/vendedores.js';
import { configRouter } from './routes/config.js';
import { setupRouter } from './routes/setup.js';
import { dashboardRouter } from './routes/dashboard.js';
import { webhookRouter } from './routes/webhook.js';
import { blingRouter } from './routes/bling.js';
import { lojaRouter } from './routes/loja.js';
import { contaRouter } from './routes/conta.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors({ credentials: true }));
// `verify` guarda o corpo CRU em req.rawBody — o webhook do Bling valida a
// assinatura HMAC sobre os bytes exatos recebidos (re-serializar quebraria o hash).
app.use(
  express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(cookieParser());

// Middleware: ensure DB ready antes de qualquer request (exceto webhook,
// que inicializa o próprio DB no handler após responder).
app.use(async (req, _res, next) => {
  if (req.path === '/api/webhook/evolution') return next();
  try {
    await ensureDB();
    next();
  } catch (err) {
    next(err);
  }
});

// Webhook do Evolution vem ANTES dos routers protegidos. Vários routers do painel
// usam `router.use(requireAuth)`, que dispara para qualquer request que entra no
// router — inclusive paths que ele não declara. Se o webhook ficar depois deles,
// o primeiro router protegido intercepta o POST do Evolution e devolve 401.
app.use('/api', webhookRouter);

// Bling montado logo após o webhook: o callback (/api/bling/callback) é PÚBLICO
// (o Bling redireciona o navegador pra cá) e não pode ser interceptado pelos
// guards dos routers do painel. As demais rotas do bling usam guard por-rota.
app.use('/api', blingRouter);

// Catálogo público: rotas SEM auth (GET produtos, POST pedido). Montado antes
// dos routers do painel pelo mesmo motivo do webhook/bling — os guards de auth
// deles vazariam pra cá e devolveriam 401 na vitrine pública.
app.use('/api', lojaRouter);

// Conta do cliente final (catálogo): login/registro abertos + rotas com auth de
// cliente (cookie win_cliente). Guards são por-rota, então não vazam pro painel.
// Montado na área pública pelo mesmo motivo do /loja.
app.use('/api', contaRouter);

// Rotas públicas (login) e rotas com autenticação própria via cookie/JWT.
// O middleware de auth é aplicado dentro de cada router que precisa.
app.use('/api', authRouter);
app.use('/api', usersRouter);
app.use('/api', productsRouter);
app.use('/api', clientesRouter);
app.use('/api', orcamentosRouter);
app.use('/api', negociosRouter);
app.use('/api', vendedoresRouter);
app.use('/api', configRouter);
app.use('/api', setupRouter);
app.use('/api', dashboardRouter);

export async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;

// Roda servidor só quando invocado diretamente (não quando importado pela Vercel).
if (!process.env.VERCEL) {
  startServer();
}
