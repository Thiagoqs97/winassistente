import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword } from './auth.js';

// Auth do CLIENTE FINAL (catálogo online), separada da auth do painel.
// Reusa bcrypt (hashPassword/verifyPassword de auth.js) mas tem cookie e token
// próprios: o claim `typ: 'cliente'` impede que um token do painel seja aceito
// como cliente e vice-versa, mesmo compartilhando o JWT_SECRET.

export { hashPassword, verifyPassword };

export const CLIENTE_COOKIE_NAME = 'win_cliente';
const TOKEN_EXPIRATION = '30d';

export interface ClienteJwtPayload {
  sub: string; // cliente id
  typ: 'cliente';
  iat?: number;
  exp?: number;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET ausente ou muito curto (mínimo 32 chars). Configure no .env.');
  }
  return secret;
}

export function signClienteToken(clienteId: string): string {
  return jwt.sign({ sub: clienteId, typ: 'cliente' }, getSecret(), {
    expiresIn: TOKEN_EXPIRATION,
  });
}

export function verifyClienteToken(token: string): ClienteJwtPayload | null {
  try {
    const payload = jwt.verify(token, getSecret()) as ClienteJwtPayload;
    // Rejeita tokens que não sejam de cliente (ex.: cookie do painel reaproveitado).
    if (payload.typ !== 'cliente' || !payload.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

// Política de senha do cliente: mínimo 8 chars, igual ao admin inicial.
export function senhaValida(senha: unknown): senha is string {
  return typeof senha === 'string' && senha.length >= 8;
}

// Validação leve de email (suficiente pra UX; a unicidade real vem do índice).
export function emailValido(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
