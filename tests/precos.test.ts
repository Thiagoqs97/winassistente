import { describe, it, expect } from 'vitest';
import { compararPreco, type UltimoPrecoVendedor } from '../api/services/precos.js';

const ultimoDe = (preco: number): UltimoPrecoVendedor => ({
  descricao: 'WHEY GOLD 900G',
  marca: 'OPTIMUM',
  ultimo_preco_unit: preco,
  orcamento_numero: 'ORC-000045',
  criado_em: new Date('2026-04-01'),
});

describe('compararPreco', () => {
  it('retorna null quando não há histórico', () => {
    expect(compararPreco(100, undefined)).toBeNull();
  });

  it('retorna null quando variação é menor que 1%', () => {
    // 100 → 100.5 = +0.5%
    expect(compararPreco(100.5, ultimoDe(100))).toBeNull();
    // 100 → 99.5 = -0.5%
    expect(compararPreco(99.5, ultimoDe(100))).toBeNull();
  });

  it('detecta subida de preço', () => {
    const v = compararPreco(110, ultimoDe(100));
    expect(v).not.toBeNull();
    expect(v!.direcao).toBe('subiu');
    expect(v!.preco_anterior).toBe(100);
    expect(v!.preco_atual).toBe(110);
    expect(v!.delta_brl).toBeCloseTo(10);
    expect(v!.delta_pct).toBeCloseTo(0.1);
    expect(v!.orcamento_anterior).toBe('ORC-000045');
  });

  it('detecta queda de preço', () => {
    const v = compararPreco(90, ultimoDe(100));
    expect(v).not.toBeNull();
    expect(v!.direcao).toBe('caiu');
    expect(v!.delta_brl).toBeCloseTo(10);
    expect(v!.delta_pct).toBeCloseTo(0.1);
  });

  it('ignora preços não-positivos', () => {
    expect(compararPreco(0, ultimoDe(100))).toBeNull();
    expect(compararPreco(-1, ultimoDe(100))).toBeNull();
    expect(compararPreco(100, ultimoDe(0))).toBeNull();
  });

  it('alerta no limiar — 1% exato cai (>=)', () => {
    // 100 → 101 = exatamente 1%. Tolerância usa < 1%, então alerta.
    const v = compararPreco(101, ultimoDe(100));
    expect(v).not.toBeNull();
    expect(v!.direcao).toBe('subiu');
  });
});
