import { describe, it, expect, beforeAll } from 'vitest';
import {
  emailValido,
  senhaValida,
  signClienteToken,
  verifyClienteToken,
} from '../api/lib/cliente-auth.js';
import { signToken } from '../api/lib/auth.js';
import { registrarCliente, loginCliente, ContaError } from '../api/services/conta.js';

// JWT_SECRET pode não estar no ambiente de teste — garante um válido (≥32 chars)
// sem sobrescrever o real, já que getSecret() lê na hora da chamada.
beforeAll(() => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    process.env.JWT_SECRET = 'teste-secret-'.padEnd(40, 'x');
  }
});

describe('cliente-auth — validadores puros', () => {
  it('emailValido aceita e-mail bem formado e rejeita lixo', () => {
    expect(emailValido('thiago@win.com')).toBe(true);
    expect(emailValido('sem-arroba')).toBe(false);
    expect(emailValido('a@b')).toBe(false);
    expect(emailValido(123)).toBe(false);
  });

  it('senhaValida exige ao menos 8 caracteres', () => {
    expect(senhaValida('12345678')).toBe(true);
    expect(senhaValida('curta')).toBe(false);
    expect(senhaValida(undefined)).toBe(false);
  });
});

describe('cliente-auth — isolamento de token cliente x painel', () => {
  it('token de cliente é aceito e devolve o sub', () => {
    const t = signClienteToken('cliente-123');
    const p = verifyClienteToken(t);
    expect(p?.sub).toBe('cliente-123');
    expect(p?.typ).toBe('cliente');
  });

  it('token do PAINEL (sem typ cliente) é rejeitado pelo verify do cliente', () => {
    const painel = signToken({ sub: 'admin-1', role: 'admin', vendedor_id: null, permissions: [] });
    expect(verifyClienteToken(painel)).toBeNull();
  });

  it('lixo é rejeitado', () => {
    expect(verifyClienteToken('nao-e-um-jwt')).toBeNull();
  });
});

// A validação de registrarCliente/loginCliente roda ANTES de qualquer acesso ao
// banco — os caminhos de rejeição são testáveis sem Postgres.
describe('registrarCliente — validação (sem banco)', () => {
  const base = { nome: 'Thiago Queiroz', email: 'thiago@win.com', senha: 'segredo123', telefone: '86988887777' };

  it('rejeita nome curto', async () => {
    await expect(registrarCliente({ ...base, nome: 'T' })).rejects.toBeInstanceOf(ContaError);
  });
  it('rejeita e-mail inválido', async () => {
    await expect(registrarCliente({ ...base, email: 'invalido' })).rejects.toBeInstanceOf(ContaError);
  });
  it('rejeita senha curta', async () => {
    await expect(registrarCliente({ ...base, senha: '123' })).rejects.toBeInstanceOf(ContaError);
  });
  it('rejeita telefone sem DDD', async () => {
    await expect(registrarCliente({ ...base, telefone: '99999' })).rejects.toBeInstanceOf(ContaError);
  });
});

describe('loginCliente — validação (sem banco)', () => {
  it('rejeita e-mail/senha ausentes com status 400', async () => {
    await expect(loginCliente('', '')).rejects.toMatchObject({ status: 400 });
  });
});
