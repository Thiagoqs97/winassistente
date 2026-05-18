import { Router } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { searchClientes } from '../services/search.js';

export const clientesRouter = Router();

const FIELDS = [
  'externo_id', 'codigo', 'nome', 'fantasia', 'tipo_pessoa', 'cpf_cnpj',
  'ie_rg', 'ie_isento', 'endereco', 'numero', 'complemento', 'bairro', 'cep',
  'cidade', 'uf', 'fone', 'celular', 'email', 'email_nfe', 'contatos',
  'data_nascimento', 'tipo_contato', 'vendedor', 'observacoes',
  'regime_tributario', 'cliente_desde', 'limite_credito', 'situacao',
];

clientesRouter.get('/clientes', async (req, res) => {
  try {
    const { q, ativo, tipo_pessoa, cidade, uf } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt((req.query.limit as string) || '50'), 200);
    const offset = parseInt((req.query.offset as string) || '0');

    if (q && q.trim().length > 0) {
      const matches = await searchClientes(q.trim(), limit);
      return res.json(matches);
    }

    const conds: string[] = [];
    const params: any[] = [];
    const push = (sql: string, val: any) => { params.push(val); conds.push(sql.replace('?', `$${params.length}`)); };
    if (ativo === 'true') push('ativo = ?', true);
    if (ativo === 'false') push('ativo = ?', false);
    if (tipo_pessoa) push('tipo_pessoa = ?', tipo_pessoa);
    if (cidade) push('lower(coalesce(cidade, \'\')) LIKE ?', `%${cidade.toLowerCase()}%`);
    if (uf) push('upper(coalesce(uf, \'\')) = ?', uf.toUpperCase());
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT id, externo_id, nome, fantasia, tipo_pessoa, cpf_cnpj, cidade, uf,
              fone, celular, email, ativo, criado_em
       FROM clientes
       ${where}
       ORDER BY nome ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('GET /api/clientes error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

clientesRouter.get('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

clientesRouter.post('/clientes', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.nome || String(body.nome).trim().length === 0) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }
    const cols: string[] = [];
    const placeholders: string[] = [];
    const values: any[] = [];
    for (const f of FIELDS) {
      if (body[f] !== undefined) {
        cols.push(f);
        placeholders.push(`$${values.length + 1}`);
        values.push(body[f] === '' ? null : body[f]);
      }
    }
    if (!cols.includes('nome')) {
      cols.push('nome');
      placeholders.push(`$${values.length + 1}`);
      values.push(String(body.nome).trim());
    }
    const { rows } = await pool.query(
      `INSERT INTO clientes (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    logger.error('POST /api/clientes error', { err: err?.message });
    res.status(500).json({ error: err.message || 'Database error' });
  }
});

clientesRouter.put('/clientes/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const updateFields = [...FIELDS, 'ativo'];
    const sets: string[] = [];
    const values: any[] = [];
    for (const f of updateFields) {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        values.push(body[f] === '' ? null : body[f]);
        sets.push(`${f} = $${values.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE clientes SET ${sets.join(', ')}, atualizado_em = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(rows[0]);
  } catch (err: any) {
    logger.error('PUT /api/clientes error', { err: err?.message });
    res.status(500).json({ error: err.message || 'Database error' });
  }
});

clientesRouter.delete('/clientes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE clientes SET ativo = false, atualizado_em = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
