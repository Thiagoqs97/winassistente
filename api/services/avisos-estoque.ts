import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { sendWhatsAppMessage } from './whatsapp.js';

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export class AvisoEstoqueError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface AvisoEstoqueResumo {
  id: string;
  produtoId: number;
  descricao: string;
  marca: string | null;
  imagemUrl: string | null;
  preco: number | null;
  criadoEm: string;
}

function appUrl(): string {
  return (process.env.VITE_APP_URL || '').replace(/\/$/, '') || 'https://winassistente.vercel.app';
}

function telefoneWhatsApp(row: { celular?: string | null; fone?: string | null }): string {
  return String(row.celular || row.fone || '').replace(/\D/g, '');
}

export async function criarAvisoEstoque(clienteId: string, produtoId: number): Promise<{ jaExistia: boolean }> {
  if (!clienteId) throw new AvisoEstoqueError('Faça login para criar o aviso.', 401);
  if (!Number.isInteger(produtoId) || produtoId <= 0) throw new AvisoEstoqueError('Produto inválido.');

  const { rows: produtos } = await pool.query(
    `SELECT id, estoque_saldo
       FROM products
      WHERE id = $1 AND ativo = true AND preco_venda IS NOT NULL AND preco_venda > 0`,
    [produtoId]
  );
  if (produtos.length === 0) throw new AvisoEstoqueError('Produto não encontrado.', 404);
  if (produtos[0].estoque_saldo === null || Number(produtos[0].estoque_saldo) > 0) {
    throw new AvisoEstoqueError('Esse produto já está disponível para compra.', 409);
  }

  const { rows } = await pool.query(
    `INSERT INTO avisos_estoque (cliente_id, produto_id, status)
     VALUES ($1, $2, 'pendente')
     ON CONFLICT (cliente_id, produto_id) WHERE status = 'pendente'
     DO UPDATE SET atualizado_em = NOW()
     RETURNING (xmax <> 0) AS ja_existia`,
    [clienteId, produtoId]
  );
  return { jaExistia: rows[0]?.ja_existia === true };
}

export async function cancelarAvisoEstoque(clienteId: string, produtoId: number): Promise<void> {
  if (!Number.isInteger(produtoId) || produtoId <= 0) throw new AvisoEstoqueError('Produto inválido.');
  const { rowCount } = await pool.query(
    `UPDATE avisos_estoque
        SET status = 'cancelado', atualizado_em = NOW()
      WHERE cliente_id = $1 AND produto_id = $2 AND status = 'pendente'`,
    [clienteId, produtoId]
  );
  if (!rowCount) throw new AvisoEstoqueError('Aviso não encontrado.', 404);
}

export async function listarAvisosEstoqueCliente(clienteId: string): Promise<AvisoEstoqueResumo[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.produto_id, p.descricao, p.marca, p.imagem_url, p.preco_venda,
            to_char(a.criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em
       FROM avisos_estoque a
       JOIN products p ON p.id = a.produto_id
      WHERE a.cliente_id = $1 AND a.status = 'pendente'
      ORDER BY a.criado_em DESC`,
    [clienteId]
  );
  return rows.map((r) => ({
    id: r.id,
    produtoId: Number(r.produto_id),
    descricao: r.descricao,
    marca: r.marca,
    imagemUrl: r.imagem_url,
    preco: r.preco_venda === null ? null : Number(r.preco_venda),
    criadoEm: r.criado_em,
  }));
}

export async function listarProdutoIdsComAvisoPendente(clienteId: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT produto_id FROM avisos_estoque WHERE cliente_id = $1 AND status = 'pendente'`,
    [clienteId]
  );
  return rows.map((r) => Number(r.produto_id));
}

export async function notificarAvisosProdutosDisponiveis(
  produtoIds: number[],
  db: Queryable = pool
): Promise<{ processados: number }> {
  const ids = [...new Set(produtoIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return { processados: 0 };

  const client = db === pool ? await pool.connect() : db;
  let avisos: Array<{
    id: string;
    cliente_id: string;
    nome: string;
    celular: string | null;
    fone: string | null;
    produto_id: number;
    descricao: string;
    marca: string | null;
  }> = [];

  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `WITH candidatos AS (
         SELECT a.id
           FROM avisos_estoque a
           JOIN products p ON p.id = a.produto_id
          WHERE a.produto_id = ANY($1::int[])
            AND a.status = 'pendente'
            AND p.ativo = true
            AND p.estoque_saldo > 0
          FOR UPDATE OF a SKIP LOCKED
       )
       UPDATE avisos_estoque a
          SET status = 'processando', atualizado_em = NOW()
         FROM candidatos c
        WHERE a.id = c.id
        RETURNING a.id, a.cliente_id, a.produto_id`,
      [ids]
    );
    if (rows.length > 0) {
      const avisoIds = rows.map((r) => r.id);
      const detalhe = await client.query(
        `SELECT a.id, a.cliente_id, c.nome, c.celular, c.fone,
                p.id AS produto_id, p.descricao, p.marca
           FROM avisos_estoque a
           JOIN clientes c ON c.id = a.cliente_id
           JOIN products p ON p.id = a.produto_id
          WHERE a.id = ANY($1::uuid[])`,
        [avisoIds]
      );
      avisos = detalhe.rows;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (db === pool) (client as unknown as { release: () => void }).release();
  }

  for (const aviso of avisos) {
    const numero = telefoneWhatsApp(aviso);
    if (!numero) {
      logger.warn('aviso estoque sem telefone do cliente', { aviso_id: aviso.id, cliente_id: aviso.cliente_id });
      await pool.query(
        `UPDATE avisos_estoque SET status = 'pendente', atualizado_em = NOW() WHERE id = $1 AND status = 'processando'`,
        [aviso.id]
      );
      continue;
    }

    const produto = `${aviso.descricao}${aviso.marca ? ` - ${aviso.marca}` : ''}`;
    const link = `${appUrl()}/loja?q=${encodeURIComponent(aviso.descricao)}`;
    const primeiroNome = String(aviso.nome || '').trim().split(/\s+/)[0] || 'tudo bem';
    const texto = `Olá, ${primeiroNome}! O produto *${produto}* voltou ao estoque na WIN Distribuidora.\n\nComprar agora:\n${link}`;
    await sendWhatsAppMessage(numero, texto);
    await pool.query(
      `UPDATE avisos_estoque
          SET status = 'enviado', enviado_em = NOW(), atualizado_em = NOW()
        WHERE id = $1 AND status = 'processando'`,
      [aviso.id]
    );
  }

  return { processados: avisos.length };
}
