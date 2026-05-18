import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import {
  COOKIE_NAME,
  signToken,
  verifyPassword,
  type AuthUser,
  type Permission,
} from '../lib/auth.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();

const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function setAuthCookie(res: Response, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

authRouter.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    const { rows } = await pool.query(
      `SELECT id, email, nome, role, vendedor_id, permissions, ativo, password_hash
       FROM users WHERE lower(email) = lower($1)`,
      [String(email).trim()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }
    const u = rows[0];
    if (!u.ativo) {
      return res.status(403).json({ error: 'Usuário desativado' });
    }
    const ok = await verifyPassword(String(password), u.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const permissions: Permission[] = Array.isArray(u.permissions) ? u.permissions : [];
    const token = signToken({
      sub: u.id,
      role: u.role,
      vendedor_id: u.vendedor_id,
      permissions,
    });
    await pool.query(`UPDATE users SET ultimo_login = NOW() WHERE id = $1`, [u.id]);

    setAuthCookie(res, token);
    const user: AuthUser = {
      id: u.id,
      email: u.email,
      nome: u.nome,
      role: u.role,
      vendedor_id: u.vendedor_id,
      permissions,
    };
    res.json({ user });
  } catch (err: any) {
    logger.error('POST /auth/login error', { err: err?.message });
    res.status(500).json({ error: 'Erro ao autenticar' });
  }
});

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});
