import { Router, type Response } from 'express';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { hashPassword, PERMISSIONS, type Permission } from '../lib/auth.js';
import { requireAuth, requireRole, type AuthRequest } from '../middleware/auth.js';

export const usersRouter = Router();

// Admin-only, mas ESCOPADO nos caminhos do router. Um `.use` sem path dispara para
// QUALQUER request que entra neste router — inclusive os destinados a outros routers
// montados depois em '/api' (products, clientes, dashboard, ...). Sem o escopo, toda
// subconta (role 'sub') tomava 403 'Sem permissão' aqui antes de chegar ao destino.
usersRouter.use('/users', requireAuth, requireRole('admin'));
usersRouter.use('/permissions', requireAuth, requireRole('admin'));

function sanitizePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const p of input) {
    if (typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)) set.add(p);
  }
  return Array.from(set) as Permission[];
}

// GET /api/users — lista todos os usuários
usersRouter.get('/users', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.nome, u.role, u.vendedor_id, u.permissions,
             u.ativo, u.criado_em, u.ultimo_login,
             v.nome AS vendedor_nome
      FROM users u
      LEFT JOIN vendedores v ON v.id = u.vendedor_id
      ORDER BY u.role DESC, u.nome ASC
    `);
    res.json(rows);
  } catch (err: any) {
    logger.error('GET /users error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/users/:id — detalhe
usersRouter.get('/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.nome, u.role, u.vendedor_id, u.permissions,
             u.ativo, u.criado_em, u.ultimo_login,
             v.nome AS vendedor_nome
      FROM users u
      LEFT JOIN vendedores v ON v.id = u.vendedor_id
      WHERE u.id = $1
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/users — cria sub-login
usersRouter.post('/users', async (req: AuthRequest, res) => {
  try {
    const { email, password, nome, vendedor_id, permissions, role } = req.body || {};
    if (!email || !password || !nome) {
      return res.status(400).json({ error: 'email, password e nome são obrigatórios' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Senha precisa ter ao menos 8 caracteres' });
    }
    const finalRole = role === 'admin' ? 'admin' : 'sub';
    const cleanPerms = finalRole === 'admin' ? [] : sanitizePermissions(permissions);

    const hash = await hashPassword(String(password));
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, nome, role, vendedor_id, permissions, criado_por)
       VALUES (lower($1), $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING id, email, nome, role, vendedor_id, permissions, ativo, criado_em`,
      [
        String(email).trim(),
        hash,
        String(nome).trim(),
        finalRole,
        vendedor_id || null,
        JSON.stringify(cleanPerms),
        req.user!.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }
    logger.error('POST /users error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/users/:id — atualiza
usersRouter.put('/users/:id', async (req: AuthRequest, res) => {
  try {
    const { nome, vendedor_id, permissions, role, ativo, password } = req.body || {};
    const sets: string[] = [];
    const values: any[] = [];
    const push = (sql: string, v: any) => { values.push(v); sets.push(sql.replace('?', `$${values.length}`)); };

    if (nome !== undefined) push('nome = ?', String(nome).trim());
    if (vendedor_id !== undefined) push('vendedor_id = ?', vendedor_id || null);
    if (typeof ativo === 'boolean') push('ativo = ?', ativo);
    if (role !== undefined) {
      const r = role === 'admin' ? 'admin' : 'sub';
      push('role = ?', r);
      // ao virar admin, permissões viram []
      if (r === 'admin') push('permissions = ?::jsonb', JSON.stringify([]));
    }
    if (permissions !== undefined) {
      // se role atual ou novo é admin, ignora permissions
      const isAdminTarget = role === 'admin';
      if (!isAdminTarget) {
        const cleaned = sanitizePermissions(permissions);
        push('permissions = ?::jsonb', JSON.stringify(cleaned));
      }
    }
    if (password !== undefined) {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Senha precisa ter ao menos 8 caracteres' });
      }
      const hash = await hashPassword(String(password));
      push('password_hash = ?', hash);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    // Proteção: não permite que o admin se desative
    if (req.params.id === req.user!.id && ativo === false) {
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });
    }

    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}
       RETURNING id, email, nome, role, vendedor_id, permissions, ativo, criado_em, ultimo_login`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err: any) {
    logger.error('PUT /users error', { err: err?.message });
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/users/:id — soft delete (ativo=false)
usersRouter.delete('/users/:id', async (req: AuthRequest, res) => {
  try {
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET ativo = false WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/permissions — devolve lista de permissões disponíveis (pra UI 1b)
usersRouter.get('/permissions', (_req, res) => {
  res.json({ permissions: PERMISSIONS });
});
