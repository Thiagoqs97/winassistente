import { describe, it, expect } from 'vitest';
import { limparTexto, parseDescricao, normalizarChave, classificarCategoria, categoriaValida } from '../api/services/catalogo-enrich.js';

// Reproduz a corrupção original (UTF-8 lido como Windows-1252) para testar o
// conserto sem depender de colar bytes frágeis (alguns são chars de controle).
const CP1252_FWD: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};
function corromper(limpo: string): string {
  let out = '';
  for (const b of Buffer.from(limpo, 'utf8')) {
    out += String.fromCodePoint(CP1252_FWD[b] ?? b);
  }
  return out;
}

describe('limparTexto — conserto de mojibake (cp1252)', () => {
  it('conserta acentos corrompidos em casos reais (printáveis)', () => {
    expect(limparTexto('100% WHEY 900G REFIL - SHARK PRO SABOR:PAÃ‡OCA'))
      .toBe('100% WHEY 900G REFIL - SHARK PRO SABOR:PAÇOCA');
    expect(limparTexto('V9 PUMP 300G - SHARK PRO SABOR:LIMÃƒO'))
      .toBe('V9 PUMP 300G - SHARK PRO SABOR:LIMÃO');
    expect(limparTexto('5 MAGNÃ‰SIOS 400MG 60 CAPS - LINHO LEV'))
      .toBe('5 MAGNÉSIOS 400MG 60 CAPS - LINHO LEV');
  });

  it('reverte a corrupção para qualquer acento (round-trip, inclui chars de controle)', () => {
    for (const limpo of [
      'ÓLEO DE PRÍMULA 60 CAPS - BODYACTION',
      'ÁCIDO HIALURÔNICO 400MG 60 CAPS - LINHO LEV',
      'AGENT ORANGE DRINK 269ML - NEW MILLEN SABOR:LIMÃO C/ HORTELÃ',
      'MACARRÃO AVE MARIA COLORIDO 300G - MEXIDONA',
      'PÃO DE QUEIJO CONGELADO 400G - FORNO MÁGICO',
    ]) {
      expect(limparTexto(corromper(limpo))).toBe(limpo);
      expect(limparTexto(limpo)).toBe(limpo); // já-limpo não muda
    }
  });

  it('normaliza espaços (NBSP e duplos) e faz trim', () => {
    expect(limparTexto('100% WHEY DISPLAY C/ 10 UND -  SHARK PRO SABOR:COOKIES'))
      .toBe('100% WHEY DISPLAY C/ 10 UND - SHARK PRO SABOR:COOKIES');
    expect(limparTexto('  CREATINA 300G   ')).toBe('CREATINA 300G');
  });

  it('é idempotente: texto já limpo não muda', () => {
    const limpo = 'WHEY PROTEIN CONCENTRADO 900G - DUX SABOR:CHOCOLATE';
    expect(limparTexto(limpo)).toBe(limpo);
    expect(limparTexto(limparTexto('TASTY WHEY 900G - ADAPTOGEN SABOR:CHOCOLATE SUIÃ‡O')))
      .toBe(limparTexto('TASTY WHEY 900G - ADAPTOGEN SABOR:CHOCOLATE SUIÃ‡O'));
  });

  it('trata nulo/vazio', () => {
    expect(limparTexto(null)).toBe('');
    expect(limparTexto(undefined)).toBe('');
    expect(limparTexto('')).toBe('');
  });
});

describe('parseDescricao — marca, nome-base, variação e grupo', () => {
  it('extrai sabor, marca e nome-base', () => {
    const p = parseDescricao('100% WHEY 900G REFIL - SHARK PRO SABOR:CHOCOLATE BRANCO');
    expect(p.nomeBase).toBe('100% WHEY 900G REFIL');
    expect(p.marca).toBe('SHARK PRO');
    expect(p.variacaoTipo).toBe('sabor');
    expect(p.variacao).toBe('CHOCOLATE BRANCO');
    expect(p.grupoChave).toBe('100% WHEY 900G REFIL - SHARK PRO');
  });

  it('agrupa sabores diferentes do mesmo produto na mesma chave', () => {
    const a = parseDescricao('100% WHEY 900G REFIL - SHARK PRO SABOR:COOKIES');
    const b = parseDescricao('100% WHEY 900G REFIL - SHARK PRO SABOR:MORANGO');
    expect(a.grupoChave).toBe(b.grupoChave);
  });

  it('produto sem sabor: variação nula, grupo é o próprio produto', () => {
    const p = parseDescricao('100% CREATINE 300G - NUTRIFY');
    expect(p.nomeBase).toBe('100% CREATINE 300G');
    expect(p.marca).toBe('NUTRIFY');
    expect(p.variacaoTipo).toBeNull();
    expect(p.variacao).toBeNull();
    expect(p.grupoChave).toBe('100% CREATINE 300G - NUTRIFY');
  });

  it('variação por cor+tamanho (vestuário) agrupa por base+marca', () => {
    const p = parseDescricao('CAMISETA DRY FIT - MORMAII COR:PRETA;TAMANHO:G');
    expect(p.marca).toBe('MORMAII');
    expect(p.variacaoTipo).toBe('cor_tamanho');
    expect(p.variacao).toBe('PRETA · G');
    expect(p.grupoChave).toBe('CAMISETA DRY FIT - MORMAII');

    const q = parseDescricao('CAMISETA DRY FIT - MORMAII COR:AZUL;TAMANHO:M');
    expect(q.grupoChave).toBe(p.grupoChave);
  });

  it('variação só por cor (galão)', () => {
    const p = parseDescricao('GALÃO QUADRADO 2L - BODYACTION COR:PRETO');
    expect(p.marca).toBe('BODYACTION');
    expect(p.variacaoTipo).toBe('cor_tamanho');
    expect(p.variacao).toBe('PRETO');
  });

  it('marca usa o ÚLTIMO " - " (descrição com hífen interno)', () => {
    const p = parseDescricao('L- CARNITINA 400ML - MAX TITANIUM SABOR:MORANGO');
    expect(p.nomeBase).toBe('L- CARNITINA 400ML');
    expect(p.marca).toBe('MAX TITANIUM');
    expect(p.variacao).toBe('MORANGO');
  });

  it('sem " - ": marca nula, nome-base é a descrição inteira (a curar na revisão)', () => {
    const p = parseDescricao('OLEO DE COCO 200ML COPRA EXTRAVIRGEM POTE');
    expect(p.marca).toBeNull();
    expect(p.nomeBase).toBe('OLEO DE COCO 200ML COPRA EXTRAVIRGEM POTE');
  });

  it('grupoChave dobra acento e caixa (mesma chave p/ texto com/sem acento)', () => {
    expect(normalizarChave('MOROTIM 450 ML - UNIÃO VEGETAL'))
      .toBe(normalizarChave('MOROTIM 450 ML - UNIAO VEGETAL'));
  });
});

describe('classificarCategoria', () => {
  const casos: Array<[string, string]> = [
    ['100% WHEY 900G REFIL - SHARK PRO SABOR:MORANGO', 'proteinas'],
    ['100% CREATINE 300G - NUTRIFY', 'creatina'],
    ['MAQUIAVEL PRÉ TREINO 350G - DARKNESS', 'pre-treino'],
    ['BETA ALANINA 500MG 60 CAPS - VITAFOR', 'aminoacidos'],
    ['THERMO CUTTER SLIM 210G - BODYACTION', 'termogenicos'],
    ['CREAMASS 3KG - ATLHETICA', 'hipercaloricos'],
    ['PASTA DE AMENDOIM 300G - DR. PEANUT SABOR:BRIGADEIRO', 'pasta-amendoim'],
    ['WHEY BAR CREAMY DISPLAY C/ 12X38G - PROBIOTICA', 'barras-snacks'],
    ['PROTEIN BAR DISPLAY C/12 UN 55G - ATLHETICA', 'barras-snacks'],
    ['ENERGY DRINK LIME ZEST C/10UN - NEW MILLEN', 'bebidas-geis'],
    ['COLAGENO VERISOL C/ 30X5G - VITAFOR', 'colageno'],
    ['OMEGA 3 60 CAPS - VITAFOR', 'vitaminas-saude'],
    ['MELATONINA PREMIUM 240 CAPS - LINHO LEV', 'vitaminas-saude'],
    ['SHAMPOO ANTIQUEDA BIOCARE 250 ML - AXIS', 'beleza-cabelo'],
    ['ADOÇANTE STEVIA 40G - COLOR ANDINA', 'alimentos'],
    ['GRANOLA TRADICIONAL SEM GLÚTEN 800G - VITAO', 'alimentos'],
    ['COQUETELEIRA 600ML PRETA 3 DOSES - DUX', 'acessorios'],
    ['CAMISETA DRY FIT - MORMAII COR:PRETA;TAMANHO:G', 'vestuario'],
  ];
  for (const [desc, esperado] of casos) {
    it(`${desc.slice(0, 38)}… → ${esperado}`, () => {
      expect(classificarCategoria(desc)).toBe(esperado);
    });
  }

  it('cai em outros quando nada casa, e sempre devolve slug válido', () => {
    expect(classificarCategoria('PRODUTO MISTERIOSO XYZ 123')).toBe('outros');
    expect(categoriaValida(classificarCategoria('qualquer coisa'))).toBe(true);
  });
});
