import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { generateOrcamentoPDF } from '../services/pdf.js';

export const orcamentosRouter = Router();

orcamentosRouter.use(requireAuth);

// Isolamento: sub-login com vendedor_id vinculado só enxerga os próprios orçamentos.
// Admin e sub sem vendedor_id enxergam tudo.
function vendedorFilterClause(req: AuthRequest, paramIndex: number): { sql: string; value: string | null } {
  const u = req.user!;
  if (u.role === 'sub' && u.vendedor_id) {
    return { sql: `o.vendedor_id = $${paramIndex}`, value: u.vendedor_id };
  }
  return { sql: '', value: null };
}

orcamentosRouter.get('/orcamentos', requirePermission('orcamentos.view', 'vendas.view'), async (req: AuthRequest, res) => {
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

    // Isolamento por vendedor — adicionado APÓS filtros do client (não pode ser bypassado)
    const vf = vendedorFilterClause(req, params.length + 1);
    if (vf.sql) { params.push(vf.value); conds.push(vf.sql); }

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

orcamentosRouter.get('/orcamentos/:numero', requirePermission('orcamentos.view', 'vendas.view'), async (req: AuthRequest, res) => {
  try {
    const u = req.user!;
    const params: any[] = [req.params.numero];
    let extraWhere = '';
    if (u.role === 'sub' && u.vendedor_id) {
      params.push(u.vendedor_id);
      extraWhere = ' AND o.vendedor_id = $2';
    }
    const { rows } = await pool.query(
      `SELECT o.*, v.numero_whatsapp AS vendedor_whatsapp, v.nome AS vendedor_nome
       FROM orcamentos o
       LEFT JOIN vendedores v ON v.id = o.vendedor_id
       WHERE o.numero = $1${extraWhere}`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

async function patchStatus(req: AuthRequest, res: Response, novoStatus: 'venda' | 'cancelado' | 'aberto') {
  try {
    const u = req.user!;
    const params: any[] = [req.params.numero];
    let extraWhere = '';
    if (u.role === 'sub' && u.vendedor_id) {
      params.push(u.vendedor_id);
      extraWhere = ' AND vendedor_id = $2';
    }
    const { rows } = await pool.query(
      `UPDATE orcamentos SET status = $${params.length + 1}, atualizado_em = NOW()
       WHERE numero = $1${extraWhere} RETURNING *`,
      [...params, novoStatus]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Orçamento não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
}

orcamentosRouter.patch('/orcamentos/:numero/cancelar', requirePermission('orcamentos.edit'), (req: AuthRequest, res) => patchStatus(req, res, 'cancelado'));
orcamentosRouter.patch('/orcamentos/:numero/fechar', requirePermission('orcamentos.edit'), (req: AuthRequest, res) => patchStatus(req, res, 'venda'));
orcamentosRouter.patch('/orcamentos/:numero/reabrir', requirePermission('orcamentos.edit'), (req: AuthRequest, res) => patchStatus(req, res, 'aberto'));

// PDF do orçamento (Fase 3.2). Respeita o mesmo isolamento por vendedor.
orcamentosRouter.get('/orcamentos/:numero/pdf', requirePermission('orcamentos.view', 'vendas.view'), async (req: AuthRequest, res) => {
  try {
    const u = req.user!;
    const scope = u.role === 'sub' && u.vendedor_id ? u.vendedor_id : undefined;
    const buf = await generateOrcamentoPDF(req.params.numero, { vendedorIdScope: scope });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.numero}.pdf"`);
    res.setHeader('Content-Length', buf.length.toString());
    res.send(buf);
  } catch (err: any) {
    if (err?.code === 'NOT_FOUND') return res.status(404).json({ error: 'Orçamento não encontrado' });
    logger.error('GET /api/orcamentos/:numero/pdf error', { err: err?.message, stack: err?.stack });
    res.status(500).json({ error: 'Erro ao gerar PDF' });
  }
});
