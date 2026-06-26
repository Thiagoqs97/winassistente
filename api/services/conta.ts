import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword, emailValido, senhaValida, cpfCnpjValido, soDigitosDoc } from '../lib/cliente-auth.js';
import type { ClienteAuth } from '../middleware/cliente-auth.js';

export class ContaError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function soDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

// Perfil que devolvemos ao frontend após login/registro. Nunca inclui senha_hash.
async function perfilDoCliente(clienteId: string): Promise<ClienteAuth> {
  const { rows } = await pool.query(
    `SELECT id, nome, email, celular, fone, cpf_cnpj, tipo_pessoa, segmento,
            to_char(data_nascimento, 'YYYY-MM-DD') AS data_nascimento
       FROM clientes WHERE id = $1`,
    [clienteId]
  );
  const r = rows[0];
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    celular: r.celular,
    fone: r.fone,
    cpf_cnpj: r.cpf_cnpj,
    tipo_pessoa: r.tipo_pessoa,
    segmento: r.segmento,
    data_nascimento: r.data_nascimento,
  };
}

export interface RegistrarInput {
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  cpf_cnpj?: string;
  segmento?: string;
}

// Cadastra a conta do cliente. CPF/CNPJ é OBRIGATÓRIO e é a chave de vínculo:
// se já existe um `clientes` na base SEM conta (senha_hash nulo) com esse mesmo
// documento, a conta ASSUME aquele registro — e como os pedidos apontam pro
// clientes.id, todo o histórico (catálogo + WhatsApp + painel) passa a aparecer
// pro cliente. Um documento = uma conta: se o documento já tem conta, manda logar.
export async function registrarCliente(input: RegistrarInput): Promise<{ id: string; cliente: ClienteAuth }> {
  const nome = (input.nome ?? '').trim();
  const email = (input.email ?? '').trim().toLowerCase();
  const senha = input.senha ?? '';
  const telefone = (input.telefone ?? '').trim();
  const cpfCnpj = (input.cpf_cnpj ?? '').trim();
  const segmento = (input.segmento ?? '').trim();

  if (nome.length < 2) throw new ContaError('Informe seu nome completo.');
  if (!emailValido(email)) throw new ContaError('Informe um e-mail válido.');
  if (!senhaValida(senha)) throw new ContaError('A senha precisa ter ao menos 8 caracteres.');
  if (soDigitos(telefone).length < 10) throw new ContaError('Informe um celular com DDD.');
  if (!cpfCnpjValido(cpfCnpj)) throw new ContaError('Informe um CPF ou CNPJ válido.');

  const senhaHash = await hashPassword(senha);
  const doc = soDigitosDoc(cpfCnpj);
  const tipoPessoa = doc.length === 14 ? 'J' : 'F';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Email já pertence a uma conta? (índice único parcial garante no banco, mas
    // checamos antes pra devolver mensagem amigável em vez de erro 23505 cru.)
    const emailComConta = await client.query(
      `SELECT 1 FROM clientes WHERE lower(email) = $1 AND senha_hash IS NOT NULL LIMIT 1`,
      [email]
    );
    if (emailComConta.rows.length > 0) {
      throw new ContaError('Esse e-mail já tem conta. Faça login.', 409);
    }

    // Documento já vinculado a uma conta? → 1 documento = 1 conta.
    const docComConta = await client.query(
      `SELECT 1 FROM clientes
        WHERE senha_hash IS NOT NULL
          AND regexp_replace(coalesce(cpf_cnpj, ''), '\\D', '', 'g') = $1
        LIMIT 1`,
      [doc]
    );
    if (docComConta.rows.length > 0) {
      throw new ContaError('Esse CPF/CNPJ já tem conta. Faça login.', 409);
    }

    // Cliente já na base (sem conta) com esse documento → assume o registro.
    const existente = await client.query(
      `SELECT id FROM clientes
        WHERE senha_hash IS NULL
          AND regexp_replace(coalesce(cpf_cnpj, ''), '\\D', '', 'g') = $1
        ORDER BY atualizado_em DESC NULLS LAST, criado_em DESC
        LIMIT 1`,
      [doc]
    );

    let clienteId: string;
    let assumiu = false;
    if (existente.rows.length > 0) {
      clienteId = existente.rows[0].id;
      assumiu = true;
      await client.query(
        `UPDATE clientes
            SET nome = $2,
                email = $3,
                celular = COALESCE(NULLIF(celular, ''), $4),
                cpf_cnpj = COALESCE(NULLIF(cpf_cnpj, ''), $5),
                segmento = COALESCE($6, segmento),
                senha_hash = $7,
                conta_criada_em = NOW(),
                ativo = true,
                situacao = 'Ativo',
                atualizado_em = NOW()
          WHERE id = $1`,
        [clienteId, nome, email, telefone, cpfCnpj, segmento || null, senhaHash]
      );
    } else {
      const novo = await client.query(
        `INSERT INTO clientes (nome, email, celular, cpf_cnpj, segmento, senha_hash, conta_criada_em, situacao, ativo, tipo_pessoa)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'Ativo', true, $7)
         RETURNING id`,
        [nome, email, telefone, cpfCnpj, segmento || null, senhaHash, tipoPessoa]
      );
      clienteId = novo.rows[0].id;
    }

    await client.query('COMMIT');
    logger.info('conta cliente criada', { cliente_id: clienteId, assumiu });
    return { id: clienteId, cliente: await perfilDoCliente(clienteId) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function loginCliente(email: string, senha: string): Promise<{ id: string; cliente: ClienteAuth }> {
  const emailNorm = (email ?? '').trim().toLowerCase();
  if (!emailNorm || !senha) throw new ContaError('Informe e-mail e senha.', 400);

  const { rows } = await pool.query(
    `SELECT id, senha_hash, ativo FROM clientes
      WHERE lower(email) = $1 AND senha_hash IS NOT NULL
      LIMIT 1`,
    [emailNorm]
  );
  // Mesma mensagem pra "não existe" e "senha errada" — não vaza se o email existe.
  if (rows.length === 0) throw new ContaError('E-mail ou senha inválidos.', 401);
  const r = rows[0];
  if (!r.ativo) throw new ContaError('Conta indisponível. Fale com a gente.', 403);
  const ok = await verifyPassword(senha, r.senha_hash);
  if (!ok) throw new ContaError('E-mail ou senha inválidos.', 401);

  return { id: r.id, cliente: await perfilDoCliente(r.id) };
}

export interface PerfilInput {
  nome?: string;
  cpf_cnpj?: string;
  data_nascimento?: string | null;
  telefone?: string;
  email?: string;
  segmento?: string | null;
}

export async function atualizarPerfil(clienteId: string, input: PerfilInput): Promise<ClienteAuth> {
  const sets: string[] = [];
  const params: any[] = [];
  const push = (sql: string, val: any) => {
    params.push(val);
    sets.push(`${sql} = $${params.length}`);
  };

  if (input.nome !== undefined) {
    const nome = String(input.nome).trim();
    if (nome.length < 2) throw new ContaError('Informe seu nome completo.');
    push('nome', nome);
  }
  if (input.cpf_cnpj !== undefined) {
    const v = String(input.cpf_cnpj).trim();
    push('cpf_cnpj', v || null);
  }
  if (input.data_nascimento !== undefined) {
    const v = input.data_nascimento ? String(input.data_nascimento).trim() : null;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ContaError('Data de nascimento inválida.');
    push('data_nascimento', v);
  }
  if (input.telefone !== undefined) {
    const tel = String(input.telefone).trim();
    if (tel && soDigitos(tel).length < 10) throw new ContaError('Informe um celular com DDD.');
    push('celular', tel || null);
  }
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!emailValido(email)) throw new ContaError('Informe um e-mail válido.');
    push('email', email);
  }
  if (input.segmento !== undefined) {
    const segmento = input.segmento ? String(input.segmento).trim() : null;
    push('segmento', segmento || null);
  }

  if (sets.length === 0) return perfilDoCliente(clienteId);

  params.push(clienteId);
  try {
    await pool.query(
      `UPDATE clientes SET ${sets.join(', ')}, atualizado_em = NOW() WHERE id = $${params.length}`,
      params
    );
  } catch (err: any) {
    if (err?.code === '23505') throw new ContaError('Esse e-mail já está em uso por outra conta.', 409);
    throw err;
  }
  return perfilDoCliente(clienteId);
}

export interface PedidoResumo {
  numero: string;
  total: number;
  criado_em: string;
  statusCodigo: 'aguardando' | 'separacao' | 'concluido' | 'cancelado';
  statusLabel: string;
  itens: { descricao: string; marca: string | null; qtd: number; preco_unit: number; subtotal: number }[];
}

const STATUS_LABEL: Record<PedidoResumo['statusCodigo'], string> = {
  aguardando: 'Aguardando confirmação',
  separacao: 'Em separação',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

// "Meus pedidos": todo orçamento ancorado neste cliente. O estágio do Kanban
// (negocios), quando existe, refina o status (expedição/recebido) — senão cai
// no status do próprio orçamento.
export async function listarPedidosCliente(clienteId: string): Promise<PedidoResumo[]> {
  const { rows } = await pool.query(
    `SELECT o.numero, o.total, o.itens, o.status,
            to_char(o.criado_em, 'YYYY-MM-DD"T"HH24:MI:SS') AS criado_em,
            n.estagio
       FROM orcamentos o
       LEFT JOIN negocios n ON n.orcamento_id = o.id
      WHERE o.cliente_id = $1
      ORDER BY o.criado_em DESC`,
    [clienteId]
  );

  return rows.map((r) => {
    let codigo: PedidoResumo['statusCodigo'];
    if (r.status === 'cancelado') codigo = 'cancelado';
    else if (r.estagio === 'recebido') codigo = 'concluido';
    else if (r.estagio === 'expedicao' || r.status === 'venda') codigo = 'separacao';
    else codigo = 'aguardando';
    return {
      numero: r.numero,
      total: Number(r.total),
      criado_em: r.criado_em,
      statusCodigo: codigo,
      statusLabel: STATUS_LABEL[codigo],
      itens: Array.isArray(r.itens) ? r.itens : [],
    };
  });
}

export interface EnderecoInput {
  apelido?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  principal?: boolean;
}

export interface Endereco extends EnderecoInput {
  id: string;
  principal: boolean;
}

export async function listarEnderecos(clienteId: string): Promise<Endereco[]> {
  const { rows } = await pool.query(
    `SELECT id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, principal
       FROM cliente_enderecos
      WHERE cliente_id = $1
      ORDER BY principal DESC, criado_em ASC`,
    [clienteId]
  );
  return rows as Endereco[];
}

function validarEndereco(input: EnderecoInput): void {
  if (!String(input.logradouro ?? '').trim()) throw new ContaError('Informe o endereço (rua/avenida).');
  if (!String(input.cidade ?? '').trim()) throw new ContaError('Informe a cidade.');
  if (!String(input.uf ?? '').trim()) throw new ContaError('Informe o estado (UF).');
}

export async function criarEndereco(clienteId: string, input: EnderecoInput): Promise<Endereco> {
  validarEndereco(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Primeiro endereço do cliente é sempre principal. Se o cliente pedir
    // principal explicitamente, rebaixa os demais antes de inserir.
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM cliente_enderecos WHERE cliente_id = $1`,
      [clienteId]
    );
    const principal = input.principal === true || cnt[0].n === 0;
    if (principal) {
      await client.query(`UPDATE cliente_enderecos SET principal = false WHERE cliente_id = $1`, [clienteId]);
    }
    const { rows } = await client.query(
      `INSERT INTO cliente_enderecos
         (cliente_id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, principal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, principal`,
      [
        clienteId,
        input.apelido ?? null,
        input.cep ?? null,
        input.logradouro ?? null,
        input.numero ?? null,
        input.complemento ?? null,
        input.bairro ?? null,
        input.cidade ?? null,
        input.uf ?? null,
        principal,
      ]
    );
    await client.query('COMMIT');
    return rows[0] as Endereco;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function atualizarEndereco(
  clienteId: string,
  enderecoId: string,
  input: EnderecoInput
): Promise<Endereco> {
  validarEndereco(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dono = await client.query(
      `SELECT 1 FROM cliente_enderecos WHERE id = $1 AND cliente_id = $2`,
      [enderecoId, clienteId]
    );
    if (dono.rows.length === 0) throw new ContaError('Endereço não encontrado.', 404);

    if (input.principal === true) {
      await client.query(
        `UPDATE cliente_enderecos SET principal = false WHERE cliente_id = $1 AND id <> $2`,
        [clienteId, enderecoId]
      );
    }
    const { rows } = await client.query(
      `UPDATE cliente_enderecos SET
         apelido = $3, cep = $4, logradouro = $5, numero = $6, complemento = $7,
         bairro = $8, cidade = $9, uf = $10,
         principal = COALESCE($11, principal),
         atualizado_em = NOW()
       WHERE id = $1 AND cliente_id = $2
       RETURNING id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, principal`,
      [
        enderecoId,
        clienteId,
        input.apelido ?? null,
        input.cep ?? null,
        input.logradouro ?? null,
        input.numero ?? null,
        input.complemento ?? null,
        input.bairro ?? null,
        input.cidade ?? null,
        input.uf ?? null,
        input.principal === true ? true : null,
      ]
    );
    await client.query('COMMIT');
    return rows[0] as Endereco;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removerEndereco(clienteId: string, enderecoId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `DELETE FROM cliente_enderecos WHERE id = $1 AND cliente_id = $2`,
    [enderecoId, clienteId]
  );
  if (!rowCount) throw new ContaError('Endereço não encontrado.', 404);
}
