import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';

export const vendedoresRouter = Router();

vendedoresRouter.use(requireAuth);

// Sub-login com vendedor_id só enxerga o próprio vendedor.
function vendedorScope(req: AuthRequest): { sql: string; params: any[] } {
  const u = req.user!;
  if (u.role === 'sub' && u.vendedor_id) {
    return { sql: 'WHERE v.id = $1', params: [u.vendedor_id] };
  }
  return { sql: '', params: [] };
}

vendedoresRouter.get('/vendedores', requirePermission('vendedores.view', 'historico.view'), async (req: AuthRequest, res) => {
  try {
    const scope = vendedorScope(req);
    const { rows } = await pool.query(`
      SELECT v.id, v.numero_whatsapp, v.nome, v.ativo, v.criado_em,
             COUNT(s.id)::int AS total_sessoes,
             MAX(s.iniciada_em) AS ultima_sessao
      FROM vendedores v
      LEFT JOIN sessoes s ON s.vendedor_id = v.id
      ${scope.sql}
      GROUP BY v.id
      ORDER BY ultima_sessao DESC NULLS LAST
    `, scope.params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

vendedoresRouter.put('/vendedores/:id', requirePermission('vendedores.edit'), async (req, res) => {
  const { nome, ativo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE vendedores SET nome = COALESCE($1, nome), ativo = COALESCE($2, ativo) WHERE id = $3 RETURNING *',
      [nome, ativo, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

vendedoresRouter.get('/vendedores/:vendedorId/sessoes', requirePermission('vendedores.view', 'historico.view'), async (req: AuthRequest, res) => {
  try {
    const u = req.user!;
    // sub com vendedor_id só pode acessar as próprias sessões
    if (u.role === 'sub' && u.vendedor_id && u.vendedor_id !== req.params.vendedorId) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    const { rows } = await pool.query(`
      SELECT s.id, s.iniciada_em, s.encerrada_em, s.status,
             COUNT(m.id)::int AS total_mensagens
      FROM sessoes s
      LEFT JOIN mensagens m ON m.sessao_id = s.id
      WHERE s.vendedor_id = $1
      GROUP BY s.id
      ORDER BY s.iniciada_em DESC
    `, [req.params.vendedorId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

vendedoresRouter.get('/sessoes/:sessaoId/mensagens', requirePermission('historico.view'), async (req: AuthRequest, res) => {
  try {
    const u = req.user!;
    // Para sub com vendedor_id: valida que a sessão é dele antes de devolver as mensagens
    if (u.role === 'sub' && u.vendedor_id) {
      const { rows: sCheck } = await pool.query(
        `SELECT vendedor_id FROM sessoes WHERE id = $1`,
        [req.params.sessaoId]
      );
      if (sCheck.length === 0 || sCheck[0].vendedor_id !== u.vendedor_id) {
        return res.status(403).json({ error: 'Sem permissão' });
      }
    }
    const { rows } = await pool.query(
      'SELECT * FROM mensagens WHERE sessao_id = $1 ORDER BY criado_em ASC',
      [req.params.sessaoId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
