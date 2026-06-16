import { describe, it, expect } from 'vitest';
import { parseSaldosResponse, extrairSaldo } from '../api/services/bling.js';

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
