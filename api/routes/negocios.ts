import { Router } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { requireAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { isEstagio, moverEstagio } from '../services/negocios.js';

export const negociosRouter = Router();

negociosRouter.use(requireAuth);

// Escopo de isolamento: sub-login vinculado a um vendedor só vê/mexe nos
// próprios negócios. Admin e sub sem vínculo veem tudo.
function vendedorScope(req: AuthRequest): string | null {
  const u = req.user!;
  return u.role === 'sub' && u.vendedor_id ? u.vendedor_id : null;
}

// Lista os negócios do funil (cartões do Kanban). Não traz arquivados nem
// cancelados antigos demais (ruído visual). O front agrupa por estágio.
negociosRouter.get('/negocios', requirePermission('kanban.view'), async (req: AuthRequest, res) => {
  try {
    const scope = vendedorScope(req);
    const params: any[] = [];
    const conds: string[] = ['n.arquivado = false'];

    if (scope) { params.push(scope); conds.push(`n.vendedor_id = $${params.length}`); }

    // Cancelados envelhecem rápido no quadro: só mostra os dos últimos 30 dias.
    conds.push(`(n.estagio <> 'cancelado' OR n.atualizado_em > NOW() - INTERVAL '30 days')`);

    const where = `WHERE ${conds.join(' AND ')}`;
    const { rows } = await pool.query(
      `SELECT n.id, n.estagio, n.cliente_nome, n.orcamento_numero, n.valor,
              n.criado_em, n.atualizado_em,
              n.vendedor_id, v.nome AS vendedor_nome, v.numero_whatsapp AS vendedor_whatsapp,
              o.status AS orcamento_status
       FROM negocios n
       LEFT JOIN vendedores v ON v.id = n.vendedor_id
       LEFT JOIN orcamentos o ON o.id = n.orcamento_id
       ${where}
       ORDER BY n.atualizado_em DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (err: any) {
    logger.error('GET /api/negocios error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

// Move um cartão de coluna. Altera o status real do orçamento vinculado.
negociosRouter.patch('/negocios/:id/estagio', requirePermission('orcamentos.edit'), async (req: AuthRequest, res) => {
  try {
    const estagio = (req.body?.estagio ?? '').toString();
    if (!isEstagio(estagio)) {
      return res.status(400).json({ error: 'Estágio inválido' });
    }
    const negocio = await moverEstagio({
      negocioId: req.params.id,
      estagio,
      vendedorScope: vendedorScope(req),
    });
    if (!negocio) return res.status(404).json({ error: 'Negócio não encontrado' });
    res.json(negocio);
  } catch (err: any) {
    logger.error('PATCH /api/negocios/:id/estagio error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

// Arquiva (remove do quadro sem apagar histórico).
negociosRouter.patch('/negocios/:id/arquivar', requirePermission('orcamentos.edit'), async (req: AuthRequest, res) => {
  try {
    const scope = vendedorScope(req);
    const params: any[] = [req.params.id];
    let scopeWhere = '';
    if (scope) { params.push(scope); scopeWhere = ' AND vendedor_id = $2'; }
    const { rowCount } = await pool.query(
      `UPDATE negocios SET arquivado = true, atualizado_em = NOW() WHERE id = $1${scopeWhere}`,
      params
    );
    if ((rowCount ?? 0) === 0) return res.status(404).json({ error: 'Negócio não encontrado' });
    res.json({ ok: true });
  } catch (err: any) {
    logger.error('PATCH /api/negocios/:id/arquivar error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});
