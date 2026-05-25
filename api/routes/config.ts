import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const configRouter = Router();

configRouter.use(requireAuth);

configRouter.get('/config', requirePermission('config.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

configRouter.put('/config', requirePermission('config.edit'), async (req, res) => {
  const { core_prompt, session_timeout_hours, message_buffer_seconds } = req.body;
  // Buffer clampado em [0, 30] — 0 desliga, 30 é teto pra não estourar timeout do webhook
  const buffer = message_buffer_seconds === undefined || message_buffer_seconds === null
    ? null
    : Math.max(0, Math.min(30, Number(message_buffer_seconds)));
  try {
    const { rows } = await pool.query(
      `UPDATE system_config
       SET core_prompt = $1,
           session_timeout_hours = $2,
           message_buffer_seconds = COALESCE($3, message_buffer_seconds)
       WHERE id = 'default' RETURNING *`,
      [core_prompt, session_timeout_hours, buffer]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
