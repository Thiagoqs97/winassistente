import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { searchClientes } from '../services/search.js';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';

export const clientesRouter = Router();

clientesRouter.use(requireAuth);

const FIELDS = [
  'externo_id', 'codigo', 'nome', 'fantasia', 'tipo_pessoa', 'cpf_cnpj',
  'ie_rg', 'ie_isento', 'endereco', 'numero', 'complemento', 'bairro', 'cep',
  'cidade', 'uf', 'fone', 'celular', 'email', 'email_nfe', 'contatos',
  'data_nascimento', 'tipo_contato', 'vendedor', 'observacoes',
  'regime_tributario', 'cliente_desde', 'limite_credito', 'situacao',
];

clientesRouter.get('/clientes', requirePermission('clientes.view'), async (req, res) => {
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

clientesRouter.get('/clientes/:id', requirePermission('clientes.view'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

clientesRouter.post('/clientes', requirePermission('clientes.edit'), async (req, res) => {
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

clientesRouter.put('/clientes/:id', requirePermission('clientes.edit'), async (req, res) => {
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

// Histórico de orçamentos de um cliente (Fase 3.1).
// Retorna últimos N orçamentos + agregados. Respeita isolamento por vendedor.
clientesRouter.get('/clientes/:id/historico', requirePermission('clientes.view'), async (req: AuthRequest, res: Response) => {
  try {
    const u = req.user!;
    const limit = Math.min(parseInt((req.query.limit as string) || '20'), 100);

    const cli = await pool.query('SELECT id, nome, fantasia FROM clientes WHERE id = $1', [req.params.id]);
    if (cli.rows.length === 0) return res.status(404).json({ error: 'Cliente não encontrado' });

    const params: any[] = [req.params.id];
    let vendedorWhere = '';
    if (u.role === 'sub' && u.vendedor_id) {
      params.push(u.vendedor_id);
      vendedorWhere = ' AND vendedor_id = $2';
    }

    const lim = params.length + 1;
    params.push(limit);
    const { rows: orcs } = await pool.query(
      `SELECT o.id, o.numero, o.status, o.total, o.criado_em, o.atualizado_em,
              o.itens, o.cliente_nome,
              v.nome AS vendedor_nome, v.numero_whatsapp AS vendedor_whatsapp,
              jsonb_array_length(o.itens) AS qtd_itens
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       WHERE o.cliente_id = $1${vendedorWhere}
       ORDER BY o.criado_em DESC
       LIMIT $${lim}`,
      params
    );

    // Agregados consideram o universo visível ao usuário (mesmo filtro de vendedor).
    const aggParams: any[] = [req.params.id];
    let aggWhere = '';
    if (u.role === 'sub' && u.vendedor_id) {
      aggParams.push(u.vendedor_id);
      aggWhere = ' AND vendedor_id = $2';
    }
    const { rows: aggRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_orcamentos,
         COUNT(*) FILTER (WHERE status = 'venda')::int AS total_vendas,
         COUNT(*) FILTER (WHERE status = 'aberto')::int AS total_abertos,
         COUNT(*) FILTER (WHERE status = 'cancelado')::int AS total_cancelados,
         COALESCE(SUM(total) FILTER (WHERE status = 'venda'), 0)::numeric AS valor_vendas,
         MAX(criado_em) FILTER (WHERE status = 'venda') AS ultima_venda,
         MAX(criado_em) AS ultimo_orcamento
       FROM orcamentos
       WHERE cliente_id = $1${aggWhere}`,
      aggParams
    );

    res.json({
      cliente: cli.rows[0],
      agregados: aggRows[0],
      orcamentos: orcs,
    });
  } catch (err: any) {
    logger.error('GET /api/clientes/:id/historico error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

clientesRouter.delete('/clientes/:id', requirePermission('clientes.delete'), async (req, res) => {
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
