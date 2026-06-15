import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { criarPedidoCatalogo, PedidoInvalidoError, reenriquecerProdutos } from '../api/services/loja.js';
import { lojaRouter } from '../api/routes/loja.js';
import { usersRouter } from '../api/routes/users.js';

// Mock de Queryable: devolve `rows` para o SELECT e captura os UPDATEs.
// Permite testar reenriquecerProdutos sem Postgres (o .env aponta pra prod).
function mockDb(rows: any[]) {
  const updates: { text: string; params: any[] }[] = [];
  const db = {
    updates,
    query: async (text: string, params: any[] = []) => {
      if (/^\s*select/i.test(text)) return { rows };
      updates.push({ text, params });
      return { rows: [] };
    },
  };
  return db;
}

describe('reenriquecerProdutos — deriva campos do catálogo (sem banco)', () => {
  it('limpa descrição, extrai marca/nome-base/variação e classifica categoria', async () => {
    const db = mockDb([
      { id: 1, descricao: '100% WHEY 900G REFIL - SHARK PRO SABOR:PAÃ‡OCA', categoria: null },
    ]);
    const r = await reenriquecerProdutos(db as any);
    expect(r).toEqual({ total: 1, descricoesLimpas: 1, categorizados: 1 });

    // params da VALUES: [id, descricao, marca, nome_base, variacao, variacao_tipo, grupo_chave, categoria]
    const p = db.updates[0].params;
    expect(p[1]).toBe('100% WHEY 900G REFIL - SHARK PRO SABOR:PAÇOCA'); // mojibake corrigido
    expect(p[2]).toBe('SHARK PRO');           // marca
    expect(p[3]).toBe('100% WHEY 900G REFIL'); // nome_base
    expect(p[4]).toBe('PAÇOCA');               // variacao
    expect(p[5]).toBe('sabor');                // variacao_tipo
    expect(p[6]).toBe('100% WHEY 900G REFIL - SHARK PRO'); // grupo_chave
    expect(p[7]).toBe('proteinas');            // categoria classificada
  });

  it('não conta como "categorizado" produto que já tem categoria curada', async () => {
    const db = mockDb([
      { id: 7, descricao: '100% CREATINE 300G - NUTRIFY', categoria: 'creatina' },
    ]);
    const r = await reenriquecerProdutos(db as any);
    expect(r.categorizados).toBe(0); // já tinha categoria → preservada pelo COALESCE no SQL
  });

  it('o sabor NÃO polui a categoria: sabores do mesmo whey caem todos em proteinas', async () => {
    const db = mockDb([
      { id: 1, descricao: '100% WHEY 900G REFIL - SHARK PRO SABOR:COOKIES', categoria: null },
      { id: 2, descricao: '100% WHEY 900G REFIL - SHARK PRO SABOR:CHOCOLATE BRANCO', categoria: null },
      { id: 3, descricao: '100% WHEY 900G REFIL - SHARK PRO SABOR:MORANGO', categoria: null },
    ]);
    await reenriquecerProdutos(db as any);
    // Os 3 produtos entram num único UPDATE (chunk), params concatenados em blocos
    // de 8 colunas — a categoria é a 8ª de cada bloco.
    const params = db.updates[0].params;
    const cats = [0, 1, 2].map((i) => params[i * 8 + 7]);
    expect(cats).toEqual(['proteinas', 'proteinas', 'proteinas']);
  });
});

// A validação de entrada de criarPedidoCatalogo roda ANTES de qualquer acesso ao
// banco (nome, telefone, carrinho). Logo, os caminhos de rejeição são testáveis
// sem Postgres — e são a barreira que protege a rota PÚBLICA do catálogo.
describe('criarPedidoCatalogo — validação (sem banco)', () => {
  const itensOk = [{ produtoId: 1, qtd: 2 }];

  it('rejeita nome vazio', async () => {
    await expect(criarPedidoCatalogo({ nome: '', telefone: '86999998888', itens: itensOk }))
      .rejects.toBeInstanceOf(PedidoInvalidoError);
  });

  it('rejeita telefone sem DDD / curto', async () => {
    await expect(criarPedidoCatalogo({ nome: 'João', telefone: '12345', itens: itensOk }))
      .rejects.toBeInstanceOf(PedidoInvalidoError);
  });

  it('rejeita carrinho vazio', async () => {
    await expect(criarPedidoCatalogo({ nome: 'João', telefone: '86999998888', itens: [] }))
      .rejects.toBeInstanceOf(PedidoInvalidoError);
  });

  it('rejeita itens com quantidade <= 0 (carrinho efetivamente vazio)', async () => {
    await expect(criarPedidoCatalogo({ nome: 'João', telefone: '86999998888', itens: [{ produtoId: 1, qtd: 0 }] }))
      .rejects.toBeInstanceOf(PedidoInvalidoError);
  });

  it('rejeita produtoId inválido', async () => {
    await expect(criarPedidoCatalogo({ nome: 'João', telefone: '86999998888', itens: [{ produtoId: NaN, qtd: 1 }] }))
      .rejects.toBeInstanceOf(PedidoInvalidoError);
  });
});

// A rota /api/loja/* é pública: montada antes dos routers do painel, NÃO pode ser
// barrada pelos guards de auth deles (mesmo motivo do routing-guards.test.ts).
// Pedido inválido tem que voltar 400 (validação) e nunca 401/403 (auth).
function buildApp() {
  const app = express();
  app.use(express.json());
  // Mesma ordem do server.ts: router do painel (guard admin) antes do catálogo.
  app.use('/api', usersRouter);
  app.use('/api', lojaRouter);
  return app;
}

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const server = buildApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('POST /api/loja/pedido é público (não barra em auth)', () => {
  it('pedido inválido volta 400 da validação, não 401/403 de auth', async () => {
    const res = await post('/api/loja/pedido', { nome: '', telefone: '', itens: [] });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBeTruthy();
  });
});
