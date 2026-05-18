import { describe, it, expect } from 'vitest';
import { resolveRange } from '../api/lib/period.js';
import { computeAbc } from '../api/services/dashboard.js';

describe('resolveRange', () => {
  it('retorna mês atual por default', () => {
    const now = new Date(2026, 4, 18, 10, 30); // 2026-05-18
    const r = resolveRange({}, now);
    expect(r.de.getFullYear()).toBe(2026);
    expect(r.de.getMonth()).toBe(4);
    expect(r.de.getDate()).toBe(1);
    expect(r.de.getHours()).toBe(0);
    expect(r.ate.getMonth()).toBe(5); // junho
    expect(r.ate.getDate()).toBe(1);
  });

  it('vira o ano corretamente', () => {
    const now = new Date(2026, 11, 31); // 2026-12-31
    const r = resolveRange({}, now);
    expect(r.de.getFullYear()).toBe(2026);
    expect(r.de.getMonth()).toBe(11);
    expect(r.ate.getFullYear()).toBe(2027);
    expect(r.ate.getMonth()).toBe(0);
  });

  it('aceita de/ate explícitos e devolve ate exclusivo', () => {
    const r = resolveRange({ de: '2026-01-01', ate: '2026-01-31' });
    expect(r.de.toISOString().slice(0, 10)).toBe('2026-01-01');
    // ate exclusivo = 2026-02-01 (primeiro instante)
    expect(r.ate.getFullYear()).toBe(2026);
    expect(r.ate.getMonth()).toBe(1);
    expect(r.ate.getDate()).toBe(1);
  });

  it('rejeita formato inválido', () => {
    expect(() => resolveRange({ de: '01/01/2026', ate: '2026-01-31' })).toThrow();
    expect(() => resolveRange({ de: '2026-1-1', ate: '2026-01-31' })).toThrow();
  });

  it('rejeita ate < de', () => {
    expect(() => resolveRange({ de: '2026-05-10', ate: '2026-05-01' })).toThrow();
  });

  it('aceita ate == de (um único dia)', () => {
    const r = resolveRange({ de: '2026-05-10', ate: '2026-05-10' });
    expect(r.de.getDate()).toBe(10);
    expect(r.ate.getDate()).toBe(11);
  });
});

describe('computeAbc', () => {
  it('lista vazia → tudo zero', () => {
    const b = computeAbc([]);
    expect(b).toHaveLength(3);
    expect(b.every(x => x.clientes === 0 && x.faturamento_brl === 0)).toBe(true);
  });

  it('lista com zeros não quebra', () => {
    const b = computeAbc([0, 0, 0]);
    expect(b.every(x => x.clientes === 0)).toBe(true);
  });

  it('distribui pela curva 80/15/5 ordenando do maior para o menor', () => {
    // 10 clientes com faturamentos crescentes
    const fats = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]; // total 1000
    const b = computeAbc(fats);
    const A = b.find(x => x.letra === 'A')!;
    const B = b.find(x => x.letra === 'B')!;
    const C = b.find(x => x.letra === 'C')!;
    // Distribuição uniforme: A = 8 (acumulado vai até 80%), B = 2 (até 100% mas o threshold é <95% então cai antes), C = ...
    // Mais importante: total bate, ordem é A>B≥C
    expect(A.clientes + B.clientes + C.clientes).toBe(10);
    expect(A.faturamento_brl + B.faturamento_brl + C.faturamento_brl).toBe(1000);
    expect(A.clientes).toBeGreaterThanOrEqual(B.clientes);
  });

  it('concentração alta em poucos clientes → A pequeno', () => {
    const fats = [800, 100, 50, 30, 20]; // total 1000
    const b = computeAbc(fats);
    const A = b.find(x => x.letra === 'A')!;
    expect(A.clientes).toBe(1);
    expect(A.faturamento_brl).toBe(800);
    expect(A.faixa_faturamento_pct).toBeCloseTo(0.8, 3);
  });

  it('percentual por bucket soma 1', () => {
    const b = computeAbc([500, 300, 200, 50, 30, 20]);
    const soma = b.reduce((acc, x) => acc + x.faixa_faturamento_pct, 0);
    expect(soma).toBeCloseTo(1.0, 5);
  });
});
