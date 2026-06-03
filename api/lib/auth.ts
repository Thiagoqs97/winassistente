import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Permissões granulares para sub-logins. Admin tem todas implicitamente.
// Mantenha em sync com o frontend (src/lib/permissions.ts será criado na 1b).
export const PERMISSIONS = [
  'products.view',
  'products.edit',
  'products.import',
  'clientes.view',
  'clientes.edit',
  'clientes.delete',
  'orcamentos.view',
  'orcamentos.edit',
  'kanban.view',
  'vendas.view',
  'vendedores.view',
  'vendedores.edit',
  'historico.view',
  'config.view',
  'config.edit',
  'dashboard.view',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface AuthUser {
  id: string;
  email: string;
  nome: string;
  role: 'admin' | 'sub';
  vendedor_id: string | null;
  permissions: Permission[];
}

export interface JwtPayload {
  sub: string; // user id
  role: 'admin' | 'sub';
  vendedor_id: string | null;
  permissions: Permission[];
  iat?: number;
  exp?: number;
}

const TOKEN_EXPIRATION = '7d';
export const COOKIE_NAME = 'win_auth';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ausente ou muito curto (mínimo 32 chars). Configure no .env.');
  }
  return secret;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRATION });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, getSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

export function hasPermission(user: AuthUser, perm: Permission): boolean {
  if (user.role === 'admin') return true;
  return user.permissions.includes(perm);
}
