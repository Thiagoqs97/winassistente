import { describe, it, expect } from 'vitest';
import { renderOrcamentoPDF } from '../api/services/pdf.js';

const orcFake = {
  numero: 'ORC-000123',
  cliente_id: null,
  cliente_nome: 'CLIENTE TESTE LTDA',
  itens: [
    { descricao: 'CREATINA CREAPURE 300G', marca: 'DUX', codigo: 1381, un: 'UN', qtd: 2, preco_unit: 236.2, subtotal: 472.4 },
    { descricao: 'PROTEIN CRUSH 900G', marca: 'UNDER LABZ', codigo: 195, un: 'UN', qtd: 1, preco_unit: 91.2, subtotal: 91.2 },
  ],
  total: 563.6,
  criado_em: '2026-05-13T16:27:00.000Z',
  status: 'aberto',
  vendedor_nome: 'AIRINE DOS SANTOS SILVA',
};

const clienteFake = {
  nome: 'R DE S MENESES LTDA',
  fantasia: 'CORPUS SUPPLEMENTS NUTRIÇÃO ESP.',
  tipo_pessoa: 'Pessoa Jurídica',
  cpf_cnpj: '36.833.981/0001-03',
  ie_rg: '126411719',
  endereco: 'Praça Alcebíades Silva',
  numero: '1817',
  complemento: 'PONTO COMERCIAL',
  bairro: 'CENTRO',
  cep: '65400000',
  cidade: 'Codó',
  uf: 'MA',
  fone: '(99) 98122-3533',
  celular: null,
  email: 'corpus.supplements@gmail.com',
};

describe('renderOrcamentoPDF', () => {
  it('gera um Buffer com header PDF válido', async () => {
    const buf = await renderOrcamentoPDF(orcFake as any, clienteFake as any);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    // Header dos arquivos PDF começa com %PDF-
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('funciona quando cliente vem null (usa fallback cliente_nome)', async () => {
    const buf = await renderOrcamentoPDF(orcFake as any, null);
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('gera PDF com lista vazia de itens sem quebrar', async () => {
    const buf = await renderOrcamentoPDF({ ...orcFake, itens: [], total: 0 } as any, clienteFake as any);
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
