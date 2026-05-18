import { Router } from 'express';
import { logger } from '../lib/logger.js';
import { resolveRange } from '../lib/period.js';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';
import {
  getKpis, getRankingVendedores, getTopProdutos, getClientesAnalise, getFunil, getCustoIa,
  type VendedorScope,
} from '../services/dashboard.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.use('/dashboard', requirePermission('dashboard.view'));

// Sub-login com vendedor_id vê só os próprios números. Admin e sub sem vínculo veem tudo.
function scopeFor(req: AuthRequest): VendedorScope {
  const u = req.user!;
  if (u.role === 'sub' && u.vendedor_id) return { vendedorId: u.vendedor_id };
  return { vendedorId: null };
}

function parseRange(req: AuthRequest) {
  try {
    return { range: resolveRange(req.query as Record<string, string | undefined>), error: null as null | string };
  } catch (err: any) {
    return { range: null, error: err.message as string };
  }
}

function clampLimit(raw: string | undefined, def = 10, max = 50): number {
  const n = parseInt(raw || '');
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

dashboardRouter.get('/dashboard/kpis', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  try {
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, ...await getKpis(range, scopeFor(req)) });
  } catch (err: any) {
    logger.error('GET /dashboard/kpis error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

dashboardRouter.get('/dashboard/ranking-vendedores', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  try {
    const rows = await getRankingVendedores(range, scopeFor(req));
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, rows });
  } catch (err: any) {
    logger.error('GET /dashboard/ranking-vendedores error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

dashboardRouter.get('/dashboard/top-produtos', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  const limit = clampLimit(req.query.limit as string | undefined);
  try {
    const data = await getTopProdutos(range, scopeFor(req), limit);
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, limit, ...data });
  } catch (err: any) {
    logger.error('GET /dashboard/top-produtos error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

dashboardRouter.get('/dashboard/clientes', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  const limit = clampLimit(req.query.limit as string | undefined);
  try {
    const data = await getClientesAnalise(range, scopeFor(req), limit);
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, limit, ...data });
  } catch (err: any) {
    logger.error('GET /dashboard/clientes error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

dashboardRouter.get('/dashboard/funil', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  try {
    const data = await getFunil(range, scopeFor(req));
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, ...data });
  } catch (err: any) {
    logger.error('GET /dashboard/funil error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

dashboardRouter.get('/dashboard/custo-ia', async (req: AuthRequest, res) => {
  const { range, error } = parseRange(req);
  if (!range) return res.status(400).json({ error });
  try {
    const data = await getCustoIa(range, scopeFor(req));
    res.json({ range: { de: range.de.toISOString(), ate: range.ate.toISOString() }, ...data });
  } catch (err: any) {
    logger.error('GET /dashboard/custo-ia error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});
