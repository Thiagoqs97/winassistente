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
import { vendedoresRouter } from './routes/vendedores.js';
import { configRouter } from './routes/config.js';
import { setupRouter } from './routes/setup.js';
import { dashboardRouter } from './routes/dashboard.js';
import { webhookRouter } from './routes/webhook.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(cors({ credentials: true }));
app.use(express.json({ limit: '50mb' }));
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

// Rotas públicas (login) e rotas com autenticação própria via cookie/JWT.
// O middleware de auth é aplicado dentro de cada router que precisa.
app.use('/api', authRouter);
app.use('/api', usersRouter);
app.use('/api', productsRouter);
app.use('/api', clientesRouter);
app.use('/api', orcamentosRouter);
app.use('/api', vendedoresRouter);
app.use('/api', configRouter);
app.use('/api', setupRouter);
app.use('/api', dashboardRouter);
app.use('/api', webhookRouter);

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
