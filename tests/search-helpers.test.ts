import { describe, it, expect } from 'vitest';
import { __internals } from '../api/services/search.js';

const { normalizeTerm, extractKeywords, STOP_WORDS } = __internals;

describe('normalizeTerm', () => {
  it('separa número de unidade', () => {
    expect(normalizeTerm('300g')).toBe('300 g');
    expect(normalizeTerm('1kg')).toBe('1 kg');
    expect(normalizeTerm('500ml')).toBe('500 ml');
    expect(normalizeTerm('2l')).toBe('2 l');
  });

  it('aceita variações de grafia', () => {
    expect(normalizeTerm('300gr')).toBe('300 g');
    expect(normalizeTerm('300gramas')).toBe('300 g');
    expect(normalizeTerm('1quilo')).toBe('1 kg');
    expect(normalizeTerm('1 kg')).toBe('1 kg');
    expect(normalizeTerm('500 ml')).toBe('500 ml');
  });

  it('remove pontuação e normaliza espaços', () => {
    expect(normalizeTerm('whey, gold!')).toBe('whey gold');
    expect(normalizeTerm('  creatina   dux  ')).toBe('creatina dux');
  });

  it('combina nome+marca+gramatura', () => {
    expect(normalizeTerm('creatina dux 300g')).toBe('creatina dux 300 g');
  });

  it('preserva minúsculas', () => {
    expect(normalizeTerm('WHEY GOLD')).toBe('whey gold');
  });
});

describe('extractKeywords', () => {
  it('separa strong (palavras ≥3) de weak (números e unidades)', () => {
    const { strong, weak } = extractKeywords('creatina dux 300 g');
    expect(strong).toEqual(['creatina', 'dux']);
    expect(weak).toEqual(['300', 'g']);
  });

  it('ignora stop words', () => {
    const { strong, weak } = extractKeywords('whey de chocolate 1 kg');
    expect(strong).toEqual(['whey', 'chocolate']);
    expect(weak).toEqual(['1', 'kg']);
  });

  it('palavras < 3 chars que não são unidade são ignoradas', () => {
    const { strong, weak } = extractKeywords('xy whey');
    expect(strong).toEqual(['whey']);
    expect(weak).toEqual([]);
  });

  it('número puro vai pra weak', () => {
    const { strong, weak } = extractKeywords('150 produto');
    expect(strong).toEqual(['produto']);
    expect(weak).toEqual(['150']);
  });
});

describe('STOP_WORDS', () => {
  it('contém preposições comuns PT-BR', () => {
    expect(STOP_WORDS.has('de')).toBe(true);
    expect(STOP_WORDS.has('da')).toBe(true);
    expect(STOP_WORDS.has('do')).toBe(true);
    expect(STOP_WORDS.has('com')).toBe(true);
    expect(STOP_WORDS.has('sem')).toBe(true);
  });
});
