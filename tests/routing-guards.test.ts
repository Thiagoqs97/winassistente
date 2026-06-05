import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { usersRouter } from '../api/routes/users.js';
import { setupRouter } from '../api/routes/setup.js';

// Regressão (subcontas zeradas / "Sem permissão"): os routers admin-only montados em
// '/api' não podem vazar seus guards para requests destinados a OUTROS routers montados
// depois. Antes, `usersRouter.use(requireAuth, requireRole('admin'))` (sem path) disparava
// para QUALQUER request que entrava no router — então toda subconta (role 'sub') tomava
// 401/403 em /api/products, /api/clientes, /api/dashboard/* etc. antes de chegar ao destino.
// setupRouter tinha o mesmo problema e ficava logo antes do dashboardRouter.
//
// Estas rotas caem ANTES de qualquer requireAuth (o path não casa com os guards já
// escopados), então o teste roda sem banco de dados.
function buildApp() {
  const app = express();
  app.use(express.json());
  // Mesma ordem do server.ts: users e setup vêm antes das rotas de dados.
  app.use('/api', usersRouter);
  app.use('/api', setupRouter);
  // Stubs representando o productsRouter (montado depois de users) e o
  // dashboardRouter (montado depois de users E de setup).
  app.get('/api/products', (_req, res) => { res.json({ reached: 'products' }); });
  app.get('/api/dashboard/kpis', (_req, res) => { res.json({ reached: 'dashboard' }); });
  return app;
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const server = buildApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('guards admin-only não vazam para rotas de dados (regressão subcontas)', () => {
  it('GET /api/products chega no productsRouter (não é barrado pelo usersRouter)', async () => {
    const res = await get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: 'products' });
  });

  it('GET /api/dashboard/kpis atravessa usersRouter E setupRouter sem 401/403', async () => {
    const res = await get('/api/dashboard/kpis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: 'dashboard' });
  });
});
