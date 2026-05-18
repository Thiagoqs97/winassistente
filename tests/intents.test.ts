import { describe, it, expect } from 'vitest';
import {
  parseNomeVendedor,
  parseConfirmacao,
  parseEscolha,
  normalizarNumeroOrcamento,
  formatClienteResumo,
} from '../api/services/intents.js';

describe('parseNomeVendedor', () => {
  it('aceita nome simples', () => {
    expect(parseNomeVendedor('João')).toBe('João');
    expect(parseNomeVendedor('joão')).toBe('João');
    expect(parseNomeVendedor('JOÃO SILVA')).toBe('João Silva');
  });

  it('remove prefixos comuns', () => {
    expect(parseNomeVendedor('meu nome é Maria')).toBe('Maria');
    expect(parseNomeVendedor('me chamo Pedro')).toBe('Pedro');
    expect(parseNomeVendedor('sou o Lucas')).toBe('Lucas');
    expect(parseNomeVendedor('aqui é a Ana')).toBe('Ana');
    expect(parseNomeVendedor('nome: Carla')).toBe('Carla');
  });

  it('rejeita textos com números', () => {
    expect(parseNomeVendedor('Quero 10 whey')).toBeNull();
    expect(parseNomeVendedor('João 123')).toBeNull();
  });

  it('rejeita textos muito curtos ou longos', () => {
    expect(parseNomeVendedor('J')).toBeNull();
    expect(parseNomeVendedor('a'.repeat(70))).toBeNull();
  });

  it('rejeita frases com mais de 5 palavras', () => {
    expect(parseNomeVendedor('João Pedro Silva Costa Souza Lima')).toBeNull();
  });

  it('aceita nome composto curto', () => {
    expect(parseNomeVendedor('Ana Paula')).toBe('Ana Paula');
    expect(parseNomeVendedor('Maria da Silva')).toBe('Maria Da Silva');
  });

  it('retorna null para entrada vazia', () => {
    expect(parseNomeVendedor('')).toBeNull();
    expect(parseNomeVendedor('   ')).toBeNull();
  });
});

describe('parseConfirmacao', () => {
  it('detecta sim', () => {
    expect(parseConfirmacao('sim')).toBe('sim');
    expect(parseConfirmacao('Sim')).toBe('sim');
    expect(parseConfirmacao('ok')).toBe('sim');
    expect(parseConfirmacao('isso mesmo')).toBe('sim');
    expect(parseConfirmacao('pode fechar')).toBe('sim');
    expect(parseConfirmacao('confirmo')).toBe('sim');
    expect(parseConfirmacao('manda')).toBe('sim');
    expect(parseConfirmacao('com certeza')).toBe('sim');
  });

  it('detecta nao', () => {
    expect(parseConfirmacao('não')).toBe('nao');
    expect(parseConfirmacao('nao')).toBe('nao');
    expect(parseConfirmacao('n')).toBe('nao');
    expect(parseConfirmacao('cancela isso')).toBe('nao');
    expect(parseConfirmacao('esquece')).toBe('nao');
    expect(parseConfirmacao('errado')).toBe('nao');
  });

  it('retorna ambiguo quando não bate', () => {
    expect(parseConfirmacao('blz')).toBe('ambiguo');
    expect(parseConfirmacao('talvez')).toBe('ambiguo');
    expect(parseConfirmacao('mais um whey')).toBe('ambiguo');
  });
});

describe('parseEscolha', () => {
  it('detecta número direto', () => {
    expect(parseEscolha('1', 5)).toEqual({ kind: 'numero', idx: 0 });
    expect(parseEscolha('3', 5)).toEqual({ kind: 'numero', idx: 2 });
    expect(parseEscolha('5', 5)).toEqual({ kind: 'numero', idx: 4 });
  });

  it('rejeita número fora do intervalo', () => {
    expect(parseEscolha('6', 5).kind).toBe('ambiguo');
    expect(parseEscolha('0', 5).kind).toBe('ambiguo');
  });

  it('detecta cancela', () => {
    expect(parseEscolha('cancela', 5)).toEqual({ kind: 'cancela' });
    expect(parseEscolha('cancelar', 5)).toEqual({ kind: 'cancela' });
    expect(parseEscolha('esquece', 5)).toEqual({ kind: 'cancela' });
    expect(parseEscolha('nenhum', 5)).toEqual({ kind: 'cancela' });
  });

  it('detecta novo cliente', () => {
    expect(parseEscolha('novo', 5)).toEqual({ kind: 'novo' });
    expect(parseEscolha('cadastra', 5)).toEqual({ kind: 'novo' });
    expect(parseEscolha('novo cliente', 5)).toEqual({ kind: 'novo' });
    expect(parseEscolha('cria um novo', 5)).toEqual({ kind: 'novo' });
  });

  it('detecta ordinais', () => {
    expect(parseEscolha('primeiro', 5)).toEqual({ kind: 'numero', idx: 0 });
    expect(parseEscolha('o segundo', 5)).toEqual({ kind: 'numero', idx: 1 });
    expect(parseEscolha('terceiro', 5)).toEqual({ kind: 'numero', idx: 2 });
  });

  it('aceita número com texto extra', () => {
    expect(parseEscolha('2 por favor', 5)).toEqual({ kind: 'numero', idx: 1 });
  });
});

describe('normalizarNumeroOrcamento', () => {
  it('formata dígitos puros', () => {
    expect(normalizarNumeroOrcamento('123')).toBe('ORC-000123');
    expect(normalizarNumeroOrcamento('7')).toBe('ORC-000007');
  });

  it('extrai dígitos de strings formatadas', () => {
    expect(normalizarNumeroOrcamento('ORC-000123')).toBe('ORC-000123');
    expect(normalizarNumeroOrcamento('orc-45')).toBe('ORC-000045');
    expect(normalizarNumeroOrcamento('o orçamento 7')).toBe('ORC-000007');
    expect(normalizarNumeroOrcamento('ORC 99')).toBe('ORC-000099');
  });

  it('retorna null para entrada sem dígitos', () => {
    expect(normalizarNumeroOrcamento('abc')).toBeNull();
    expect(normalizarNumeroOrcamento('')).toBeNull();
    expect(normalizarNumeroOrcamento(null)).toBeNull();
    expect(normalizarNumeroOrcamento(undefined)).toBeNull();
  });
});

describe('formatClienteResumo', () => {
  it('inclui apenas campos não-vazios', () => {
    expect(formatClienteResumo({
      nome: 'João Silva',
      fantasia: null,
      cpf_cnpj: null,
      cidade: null,
      uf: null,
    })).toBe('João Silva');
  });

  it('inclui fantasia quando diferente do nome', () => {
    expect(formatClienteResumo({
      nome: 'R DE S MENESES LTDA',
      fantasia: 'CORPUS SUPPLEMENTS',
      cpf_cnpj: null,
      cidade: null,
      uf: null,
    })).toBe('R DE S MENESES LTDA — CORPUS SUPPLEMENTS');
  });

  it('omite fantasia igual ao nome (case-insensitive)', () => {
    expect(formatClienteResumo({
      nome: 'João Silva',
      fantasia: 'joão silva',
      cpf_cnpj: null,
      cidade: null,
      uf: null,
    })).toBe('João Silva');
  });

  it('formata cidade/uf juntas', () => {
    expect(formatClienteResumo({
      nome: 'Cliente X',
      fantasia: null,
      cpf_cnpj: '123.456.789-00',
      cidade: 'Teresina',
      uf: 'PI',
    })).toBe('Cliente X — CPF/CNPJ: 123.456.789-00 — Teresina/PI');
  });
});
