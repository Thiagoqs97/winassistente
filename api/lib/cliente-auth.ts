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

// Só os dígitos de um documento (CPF/CNPJ) — usado pra validar, casar e indexar
// sem depender da formatação (pontos/barra) que a base importada possa ter.
export function soDigitosDoc(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

function validarCPF(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += Number(d[i]) * (base + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

function validarCNPJ(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: number) => {
    const pesos = base === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base; i++) soma += Number(d[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// CPF (11 díg) ou CNPJ (14 díg) com dígitos verificadores válidos.
export function cpfCnpjValido(v: unknown): v is string {
  const d = soDigitosDoc(v);
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return false;
}
