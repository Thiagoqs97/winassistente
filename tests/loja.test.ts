import { describe, it, expect } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { criarPedidoCatalogo, PedidoInvalidoError } from '../api/services/loja.js';
import { lojaRouter } from '../api/routes/loja.js';
import { usersRouter } from '../api/routes/users.js';

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
