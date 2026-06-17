import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool.js';
import { CLIENTE_COOKIE_NAME, verifyClienteToken } from '../lib/cliente-auth.js';

// Cliente final autenticado (perfil enxuto exposto ao painel da vitrine).
export interface ClienteAuth {
  id: string;
  nome: string;
  email: string | null;
  celular: string | null;
  fone: string | null;
  cpf_cnpj: string | null;
  tipo_pessoa: string | null;
  data_nascimento: string | null;
}

export interface ClienteRequest extends Request {
  cliente?: ClienteAuth;
}

function extractToken(req: Request): string | null {
  const fromCookie = (req as any).cookies?.[CLIENTE_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

// Carrega do banco a cada request (igual ao painel): garante que a conta ainda
// existe, está ativa e que os dados estão frescos. Só conta válida = registro
// ativo COM senha_hash (a base importada sem senha não é "logável").
async function loadCliente(clienteId: string): Promise<ClienteAuth | null> {
  const { rows } = await pool.query(
    `SELECT id, nome, email, celular, fone, cpf_cnpj, tipo_pessoa,
            to_char(data_nascimento, 'YYYY-MM-DD') AS data_nascimento
       FROM clientes
      WHERE id = $1 AND ativo = true AND senha_hash IS NOT NULL`,
    [clienteId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    celular: r.celular,
    fone: r.fone,
    cpf_cnpj: r.cpf_cnpj,
    tipo_pessoa: r.tipo_pessoa,
    data_nascimento: r.data_nascimento,
  };
}

export async function requireCliente(
  req: ClienteRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Faça login para continuar.' });
    return;
  }
  const payload = verifyClienteToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Sessão expirada. Entre de novo.' });
    return;
  }
  const cliente = await loadCliente(payload.sub);
  if (!cliente) {
    res.status(401).json({ error: 'Conta indisponível. Entre de novo.' });
    return;
  }
  req.cliente = cliente;
  next();
}
