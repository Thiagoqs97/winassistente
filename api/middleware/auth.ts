import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';
import {
  COOKIE_NAME,
  hasPermission,
  verifyToken,
  type AuthUser,
  type Permission,
} from '../lib/auth.js';

// AuthRequest é o tipo do request após o requireAuth — sempre tem `user`.
export interface AuthRequest extends Request {
  user?: AuthUser;
}

// Extrai e valida o JWT do cookie OU do header Authorization: Bearer ...
function extractToken(req: Request): string | null {
  const fromCookie = (req as any).cookies?.[COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

// Carrega o usuário do banco para garantir que está ativo e que os dados estão frescos.
// Isso evita usar permissões/role obsoletos do JWT depois que o admin alterou o user.
async function loadUser(userId: string): Promise<AuthUser | null> {
  const { rows } = await pool.query(
    `SELECT id, email, nome, role, vendedor_id, permissions, ativo
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r.ativo) return null;
  return {
    id: r.id,
    email: r.email,
    nome: r.nome,
    role: r.role,
    vendedor_id: r.vendedor_id,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
  };
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token inválido ou expirado' });
    return;
  }
  const user = await loadUser(payload.sub);
  if (!user) {
    res.status(401).json({ error: 'Usuário desativado ou removido' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(role: 'admin' | 'sub') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'Não autenticado' }); return; }
    if (req.user.role !== role) { res.status(403).json({ error: 'Sem permissão' }); return; }
    next();
  };
}

export function requirePermission(...perms: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) { res.status(401).json({ error: 'Não autenticado' }); return; }
    const ok = perms.some(p => hasPermission(req.user!, p));
    if (!ok) { res.status(403).json({ error: 'Sem permissão' }); return; }
    next();
  };
}
