import { Router } from 'express';
import { pool } from '../db/pool.js';

export const configRouter = Router();

configRouter.get('/config', async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM system_config WHERE id = 'default'");
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

configRouter.put('/config', async (req, res) => {
  const { core_prompt, session_timeout_hours } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE system_config SET core_prompt = $1, session_timeout_hours = $2 WHERE id = 'default' RETURNING *`,
      [core_prompt, session_timeout_hours]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});
