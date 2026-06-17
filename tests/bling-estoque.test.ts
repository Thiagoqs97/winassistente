import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { parseSaldosResponse, extrairSaldo, verifyBlingSignature } from '../api/services/bling.js';

describe('parseSaldosResponse — saldo do /estoques/saldos (sem HTTP)', () => {
  it('usa o total do topo quando vem (virtual e físico separados)', () => {
    const out = parseSaldosResponse({
      data: [{ produto: { id: 10 }, saldoFisicoTotal: 12, saldoVirtualTotal: 8 }],
    });
    expect(out).toEqual([{ produtoId: 10, saldoFisico: 12, saldoVirtual: 8 }]);
  });

  it('soma os depósitos quando o total do topo não vem', () => {
    const out = parseSaldosResponse({
      data: [
        {
          produto: { id: 20 },
          depositos: [
            { id: 1, saldoFisico: 5, saldoVirtual: 3 },
            { id: 2, saldoFisico: 4, saldoVirtual: 4 },
          ],
        },
      ],
    });
    expect(out).toEqual([{ produtoId: 20, saldoFisico: 9, saldoVirtual: 7 }]);
  });

  it('saldo nulo (sem total e sem depósitos) vira null, não 0', () => {
    const out = parseSaldosResponse({ data: [{ produto: { id: 30 } }] });
    expect(out).toEqual([{ produtoId: 30, saldoFisico: null, saldoVirtual: null }]);
  });

  it('pula linhas sem produto.id e tolera data ausente', () => {
    expect(parseSaldosResponse({})).toEqual([]);
    expect(parseSaldosResponse({ data: [{ saldoVirtualTotal: 5 } as any] })).toEqual([]);
  });

  it('saldo zerado é preservado (esgotado != desconhecido)', () => {
    const out = parseSaldosResponse({
      data: [{ produto: { id: 40 }, saldoFisicoTotal: 0, saldoVirtualTotal: 0 }],
    });
    expect(out).toEqual([{ produtoId: 40, saldoFisico: 0, saldoVirtual: 0 }]);
  });
});

describe('extrairSaldo — saldo do detalhe do produto (inspetor)', () => {
  it('prefere o virtual', () => {
    expect(extrairSaldo({ data: { estoque: { saldoFisicoTotal: 10, saldoVirtualTotal: 6 } } })).toBe(6);
  });

  it('cai pro físico quando não há virtual', () => {
    expect(extrairSaldo({ data: { estoque: { saldoFisicoTotal: 10 } } })).toBe(10);
  });

  it('null quando não há bloco de estoque', () => {
    expect(extrairSaldo({ data: {} })).toBeNull();
    expect(extrairSaldo({})).toBeNull();
  });
});

describe('verifyBlingSignature — HMAC do webhook (X-Bling-Signature-256)', () => {
  const SECRET = 'segredo-de-teste';
  const body = Buffer.from(JSON.stringify({ event: 'stock.updated', data: { produto: { id: 1 } } }));
  const assinar = (b: Buffer, s = SECRET): string =>
    'sha256=' + createHmac('sha256', s).update(b).digest('hex');

  beforeEach(() => {
    process.env.BLING_CLIENT_SECRET = SECRET;
  });

  it('aceita assinatura correta', () => {
    expect(verifyBlingSignature(body, assinar(body))).toBe(true);
  });

  it('rejeita assinatura de outro secret', () => {
    expect(verifyBlingSignature(body, assinar(body, 'outro'))).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado', () => {
    const sig = assinar(body);
    expect(verifyBlingSignature(Buffer.from(body.toString() + ' '), sig)).toBe(false);
  });

  it('rejeita header ausente, vazio ou sem o prefixo sha256=', () => {
    expect(verifyBlingSignature(body, undefined)).toBe(false);
    expect(verifyBlingSignature(body, '')).toBe(false);
    const hexSemPrefixo = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyBlingSignature(body, hexSemPrefixo)).toBe(false);
  });

  it('rejeita quando o secret não está configurado', () => {
    delete process.env.BLING_CLIENT_SECRET;
    expect(verifyBlingSignature(body, assinar(body))).toBe(false);
  });
});
