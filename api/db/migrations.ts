import { pool } from './pool.js';
import { logger } from '../lib/logger.js';

const DEFAULT_PROMPT = `1. O agente tem acesso ao histórico completo da sessão ativa e deve utilizá-lo para entender pedidos construídos em múltiplas mensagens.
2. O agente confirma os itens identificados antes de gerar qualquer orçamento, perguntando ao vendedor se os produtos encontrados correspondem ao que foi solicitado.
3. O agente gera e envia o orçamento completo após a confirmação dos itens, calculando o total, sem necessidade de intervenção humana.
4. O agente não mistura contextos de sessões diferentes — quando detecta o início de um novo pedido, trata-o de forma totalmente isolada.
5. O agente nunca inventa produtos — trabalha exclusivamente com os itens retornados pela busca no estoque.
6. NUNCA use tabelas com | para formatar o orçamento — use o formato de lista com emojis e negrito (*texto*) nativo do WhatsApp.`;

let dbInitPromise: Promise<void> | null = null;

async function initDB(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent;');

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(255) UNIQUE,
        descricao TEXT NOT NULL,
        preco_venda NUMERIC(10, 2),
        marca VARCHAR(255),
        embalagem VARCHAR(255),
        categoria VARCHAR(255),
        codigo_barras VARCHAR(255),
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS categoria VARCHAR(255);`);
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS codigo_barras VARCHAR(255);`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao
      ON products USING GIN (descricao gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao_lower
      ON products USING GIN (lower(descricao) gin_trgm_ops);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        id VARCHAR(50) PRIMARY KEY,
        core_prompt TEXT NOT NULL,
        session_timeout_hours INTEGER DEFAULT 2
      );
    `);
    await client.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS session_timeout_hours INTEGER DEFAULT 2;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendedores (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        numero_whatsapp TEXT UNIQUE NOT NULL,
        nome TEXT,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessoes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE CASCADE,
        iniciada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        encerrada_em TIMESTAMP,
        status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada', 'orcamento_gerado')),
        acao_pendente JSONB
      );
    `);
    await client.query(`ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS acao_pendente JSONB;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sessao_id UUID REFERENCES sessoes(id) ON DELETE CASCADE,
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE CASCADE,
        papel TEXT NOT NULL CHECK (papel IN ('user', 'assistant')),
        conteudo TEXT NOT NULL,
        tipo_midia TEXT DEFAULT 'texto' CHECK (tipo_midia IN ('texto', 'audio', 'imagem', 'pdf', 'planilha')),
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`ALTER TABLE sessoes DISABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE mensagens DISABLE ROW LEVEL SECURITY;`);

    await client.query(`CREATE SEQUENCE IF NOT EXISTS orcamento_numero_seq START 1;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orcamentos (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        numero TEXT UNIQUE NOT NULL,
        sessao_id UUID REFERENCES sessoes(id) ON DELETE SET NULL,
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
        cliente_nome TEXT,
        itens JSONB NOT NULL,
        total NUMERIC(10, 2) NOT NULL,
        status TEXT DEFAULT 'aberto',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP;`);

    // Ordem CRÍTICA: DROP da constraint antiga antes do UPDATE que migra os valores,
    // senão a constraint vigente bloqueia a migração de 'finalizado' → 'aberto'.
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'orcamentos' AND constraint_name = 'orcamentos_status_check'
        ) THEN
          ALTER TABLE orcamentos DROP CONSTRAINT orcamentos_status_check;
        END IF;
      END $$;
    `);
    await client.query(`UPDATE orcamentos SET status = 'aberto' WHERE status = 'finalizado';`);
    await client.query(`
      ALTER TABLE orcamentos
      ADD CONSTRAINT orcamentos_status_check
      CHECK (status IN ('aberto', 'venda', 'cancelado'));
    `);
    await client.query(`ALTER TABLE orcamentos ALTER COLUMN status SET DEFAULT 'aberto';`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor ON orcamentos(vendedor_id, criado_em DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_numero ON orcamentos(numero);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(lower(cliente_nome));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_vendedor_status ON orcamentos(vendedor_id, status, criado_em DESC);`);

    await client.query(`
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
    await client.query(`CREATE INDEX IF NOT EXISTS trgm_idx_clientes_nome ON clientes USING GIN (lower(nome) gin_trgm_ops);`);
    await client.query(`CREATE INDEX IF NOT EXISTS trgm_idx_clientes_fantasia ON clientes USING GIN (lower(coalesce(fantasia, '')) gin_trgm_ops);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON clientes(cpf_cnpj);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clientes_externo_id ON clientes(externo_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_clientes_ativo_nome ON clientes(ativo, lower(nome));`);

    await client.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente_id ON orcamentos(cliente_id);`);

    await client.query(`
      INSERT INTO system_config (id, core_prompt, session_timeout_hours)
      VALUES ('default', $1, 2)
      ON CONFLICT (id) DO NOTHING;
    `, [DEFAULT_PROMPT]);

    logger.info('Database initialized');
  } catch (err) {
    logger.error('Failed to initialize database', { err: (err as Error).message });
    throw err;
  } finally {
    client.release();
  }
}

export function ensureDB(): Promise<void> {
  if (!dbInitPromise) dbInitPromise = initDB();
  return dbInitPromise;
}
