// Cria tabela `clientes`, índices e adiciona `cliente_id` em `orcamentos`.
// Idempotente — pode rodar quantas vezes precisar.
//
// Uso: npx tsx scripts/setup-clientes.ts

import 'dotenv/config';
import { Pool } from 'pg';

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('Defina DATABASE_URL no ambiente (ex: copie de .env).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: CONN.split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function main() {
  const c = await pool.connect();
  try {
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    await c.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await c.query('CREATE EXTENSION IF NOT EXISTS unaccent;');

    await c.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        externo_id TEXT UNIQUE,
        codigo TEXT,
        nome TEXT NOT NULL,
        fantasia TEXT,
        tipo_pessoa TEXT,
        cpf_cnpj TEXT,
        ie_rg TEXT,
        ie_isento TEXT,
        endereco TEXT,
        numero TEXT,
        complemento TEXT,
        bairro TEXT,
        cep TEXT,
        cidade TEXT,
        uf TEXT,
        fone TEXT,
        celular TEXT,
        email TEXT,
        email_nfe TEXT,
        contatos TEXT,
        data_nascimento DATE,
        tipo_contato TEXT,
        vendedor TEXT,
        observacoes TEXT,
        regime_tributario TEXT,
        cliente_desde DATE,
        limite_credito NUMERIC(12,2) DEFAULT 0,
        situacao TEXT DEFAULT 'Ativo',
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP
      );
    `);
    await c.query(`CREATE INDEX IF NOT EXISTS trgm_idx_clientes_nome ON clientes USING GIN (lower(nome) gin_trgm_ops);`);
    await c.query(`CREATE INDEX IF NOT EXISTS trgm_idx_clientes_fantasia ON clientes USING GIN (lower(coalesce(fantasia, '')) gin_trgm_ops);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON clientes(cpf_cnpj);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_clientes_externo_id ON clientes(externo_id);`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_clientes_ativo_nome ON clientes(ativo, lower(nome));`);

    await c.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;`);
    await c.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente_id ON orcamentos(cliente_id);`);

    const { rows } = await c.query(`SELECT count(*)::int AS n FROM clientes`);
    console.log('OK. clientes na base:', rows[0].n);
  } catch (e) {
    console.error('Erro:', e);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main();
