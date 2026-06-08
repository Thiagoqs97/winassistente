import bcrypt from 'bcryptjs';
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
    // tags: palavras-chave/sinônimos curados manualmente no painel para reforçar a busca
    // do agente (ex.: produto descrito como "ômega" ganha tag "omega 3 epa dha").
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS tags TEXT;`);
    // imagem_url: URL pública da foto do produto no Supabase Storage. Alimentada
    // pelo sync do Bling (Fase A do catálogo) e exibida na vitrine pública.
    await client.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS imagem_url TEXT;`);

    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao
      ON products USING GIN (descricao gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_descricao_lower
      ON products USING GIN (lower(descricao) gin_trgm_ops);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS trgm_idx_products_tags
      ON products USING GIN (lower(coalesce(tags, '')) gin_trgm_ops);
    `);

    // Tokens OAuth do Bling (linha única, id sempre = 1). Usado só pra puxar a
    // imagem dos produtos. O refresh_token é renovado a cada uso (validade 30d).
    await client.query(`
      CREATE TABLE IF NOT EXISTS bling_auth (
        id INT PRIMARY KEY DEFAULT 1,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TIMESTAMPTZ,
        scope TEXT,
        updated_at TIMESTAMPTZ DEFAULT now(),
        CONSTRAINT bling_auth_singleton CHECK (id = 1)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        id VARCHAR(50) PRIMARY KEY,
        core_prompt TEXT NOT NULL,
        session_timeout_hours INTEGER DEFAULT 2
      );
    `);
    await client.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS session_timeout_hours INTEGER DEFAULT 2;`);
    await client.query(`ALTER TABLE system_config ADD COLUMN IF NOT EXISTS message_buffer_seconds INTEGER DEFAULT 5;`);

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

    // Buffer de mensagens para debounce no webhook. Quando o vendedor manda
    // várias mensagens em rápida sucessão (típico em pedidos com várias
    // imagens), só a última do "lote" dispara o processamento pelo LLM.
    // Mais detalhes em api/services/message-buffer.ts.
    await client.query(`
      CREATE TABLE IF NOT EXISTS mensagens_buffer (
        seq BIGSERIAL PRIMARY KEY,
        vendedor_id UUID NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processada_em TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mensagens_buffer_vendedor_pendente
      ON mensagens_buffer(vendedor_id, seq) WHERE processada_em IS NULL;`);

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

    // Migração idempotente da constraint de status. Tudo num único DO block:
    // (1) o pg_advisory_xact_lock serializa instâncias serverless concorrentes — sem ele,
    //     duas instâncias passam pelo IF NOT EXISTS, ambas executam ADD e a 2ª quebra com 42710,
    //     deixando o dbInitPromise da instância rejeitado e tudo retornando 500;
    // (2) se a constraint já existir com o CHECK correto, não toca em nada.
    await client.query(`
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(73219001);

        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.check_constraints cc
          JOIN information_schema.constraint_column_usage ccu
            ON cc.constraint_name = ccu.constraint_name
          WHERE ccu.table_name = 'orcamentos'
            AND cc.constraint_name = 'orcamentos_status_check'
            AND cc.check_clause LIKE '%aberto%'
            AND cc.check_clause LIKE '%venda%'
            AND cc.check_clause LIKE '%cancelado%'
        ) THEN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name = 'orcamentos' AND constraint_name = 'orcamentos_status_check'
          ) THEN
            ALTER TABLE orcamentos DROP CONSTRAINT orcamentos_status_check;
          END IF;
          UPDATE orcamentos SET status = 'aberto' WHERE status = 'finalizado';
          ALTER TABLE orcamentos
            ADD CONSTRAINT orcamentos_status_check
            CHECK (status IN ('aberto', 'venda', 'cancelado'));
        END IF;
      END $$;
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

    // --- Kanban de negócios (funil de atendimento) ---
    // Um "negócio" = um cartão do quadro Kanban. Ancorado na sessão (conversa):
    // 1 negócio por sessão (UNIQUE sessao_id). Nasce em 'novo_contato' quando a
    // conversa abre, avança automaticamente conforme o atendimento progride
    // (em_andamento → orcamento → expedicao → recebido) e pode ser movido
    // manualmente (arrastar) ou por mensagem ao assistente. O estágio é a fonte
    // de verdade da POSIÇÃO no quadro; o status do orçamento é sincronizado em
    // paralelo (aberto/venda/cancelado) — ver api/services/negocios.ts.
    await client.query(`
      CREATE TABLE IF NOT EXISTS negocios (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sessao_id UUID UNIQUE REFERENCES sessoes(id) ON DELETE CASCADE,
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE CASCADE,
        cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
        cliente_nome TEXT,
        orcamento_id UUID REFERENCES orcamentos(id) ON DELETE SET NULL,
        orcamento_numero TEXT,
        estagio TEXT NOT NULL DEFAULT 'novo_contato'
          CHECK (estagio IN ('novo_contato','em_andamento','orcamento','expedicao','recebido','cancelado')),
        valor NUMERIC(10, 2),
        arquivado BOOLEAN NOT NULL DEFAULT false,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_negocios_vendedor_estagio ON negocios(vendedor_id, estagio, atualizado_em DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_negocios_estagio ON negocios(estagio, atualizado_em DESC) WHERE arquivado = false;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_negocios_orcamento ON negocios(orcamento_id);`);

    // --- Auth (Fase 1a) ---
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nome TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'sub' CHECK (role IN ('admin', 'sub')),
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
        permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ultimo_login TIMESTAMP,
        criado_por UUID REFERENCES users(id) ON DELETE SET NULL
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(lower(email));`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_vendedor_id ON users(vendedor_id);`);

    // --- Tracking de custo de IA (Fase 1c) ---
    // FKs com ON DELETE SET NULL para preservar agregados históricos
    // mesmo quando vendedor/sessão/mensagem forem removidos.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        vendedor_id UUID REFERENCES vendedores(id) ON DELETE SET NULL,
        sessao_id UUID REFERENCES sessoes(id) ON DELETE SET NULL,
        mensagem_id UUID REFERENCES mensagens(id) ON DELETE SET NULL,
        model TEXT NOT NULL,
        purpose TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_vendedor_created ON ai_usage(vendedor_id, created_at DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_model_created ON ai_usage(model, created_at DESC);`);

    await client.query(`
      INSERT INTO system_config (id, core_prompt, session_timeout_hours)
      VALUES ('default', $1, 2)
      ON CONFLICT (id) DO NOTHING;
    `, [DEFAULT_PROMPT]);

    // Bootstrap do admin inicial — só roda se NÃO existe nenhum usuário.
    // Email e senha vêm de ADMIN_INITIAL_EMAIL / ADMIN_INITIAL_PASSWORD em env.
    await bootstrapAdmin(client);

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

async function bootstrapAdmin(client: import('pg').PoolClient): Promise<void> {
  const { rows: countRows } = await client.query(`SELECT COUNT(*)::int AS n FROM users`);
  if (countRows[0].n > 0) return;

  const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    logger.warn('Bootstrap do admin pulado: defina ADMIN_INITIAL_EMAIL e ADMIN_INITIAL_PASSWORD no .env');
    return;
  }
  if (password.length < 8) {
    logger.error('ADMIN_INITIAL_PASSWORD precisa ter ao menos 8 caracteres');
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (email, password_hash, nome, role, permissions)
     VALUES ($1, $2, $3, 'admin', '[]'::jsonb)`,
    [email, hash, 'Administrador']
  );
  logger.info('Admin inicial criado', { email });
}
