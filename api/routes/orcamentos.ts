import { Router } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

export const orcamentosRouter = Router();

orcamentosRouter.get('/orcamentos', async (req, res) => {
  try {
    const { numero, vendedor_id, cliente_nome, data_de, data_ate, status } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
    const offset = parseInt((req.query.offset as string) || '0');

    const conds: string[] = [];
    const params: any[] = [];
    const push = (sql: string, val: any) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };

    if (numero) push('o.numero ILIKE ?', `%${numero}%`);
    if (vendedor_id) push('o.vendedor_id = ?', vendedor_id);
    if (cliente_nome) push('lower(o.cliente_nome) LIKE ?', `%${cliente_nome.toLowerCase()}%`);
    if (data_de) push('o.criado_em >= ?', data_de);
    if (data_ate) push('o.criado_em <= ?', data_ate);
    if (status) push('o.status = ?', status);

    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT o.id, o.numero, o.cliente_nome, o.total, o.status, o.criado_em,
              o.vendedor_id, v.numero_whatsapp AS vendedor_whatsapp, v.nome AS vendedor_nome,
              jsonb_array_length(o.itens) AS qtd_itens
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       ${where}
       ORDER BY o.criado_em DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('GET /api/orcamentos error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

orcamentosRouter.get('/orcamentos/:numero', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, v.numero_whatsapp AS vendedor_whatsapp, v.nome AS vendedor_nome
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       WHERE o.numero = $1`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

orcamentosRouter.patch('/orcamentos/:numero/cancelar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'cancelado', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

orcamentosRouter.patch('/orcamentos/:numero/fechar', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'venda', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

orcamentosRouter.patch('/orcamentos/:numero/reabrir', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = 'aberto', atualizado_em = NOW() WHERE numero = $1 RETURNING *`,
      [req.params.numero]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
