// Importa clientes de um arquivo .txt no formato exportado pelo Tiny/Bling.
// Uso:
//   npx tsx scripts/import-clientes.ts [caminho/do/arquivo.txt]
//
// Padrão: data/contatos_formatados.txt
//
// Variáveis suportadas:
//   DATABASE_URL (preferencial)
//   ou senão usa o pooler do Supabase do projeto.

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const ARQUIVO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('data/contatos_formatados.txt');

const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error('Defina DATABASE_URL no ambiente (ex: copie de .env).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: CONN.split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 3,
});

// --- Mojibake fix ---
// Conteúdo do txt frequentemente vem como UTF-8 lido com Latin-1 (mojibake clássico).
// Para reverter: encode como Latin-1 e re-decode como UTF-8.
function fixMojibake(s: string): string {
  if (!s) return s;
  // Sinais clássicos: Ã+algo (Ã£, Ã©, Ãª, Ã³, Ã­...)
  if (!/Ã[-ÿ]|Â[-ÿ]/.test(s)) return s;
  try {
    return Buffer.from(s, 'binary').toString('utf8');
  } catch {
    return s;
  }
}

// --- Date parser BR (dd/mm/yyyy) → ISO yyyy-mm-dd ---
function parseBRDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const d = m[1].padStart(2, '0');
  const mo = m[2].padStart(2, '0');
  let y = m[3];
  if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
  return `${y}-${mo}-${d}`;
}

function parseNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = Number(String(s).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

function parseCEP(s: string | null | undefined): string | null {
  if (!s) return null;
  // Vem como "64046100.0" — pega só dígitos e pad
  const d = String(s).replace(/\D/g, '');
  if (!d) return null;
  return d.padStart(8, '0').slice(0, 8);
}

// --- Parser principal ---
type Cliente = Record<string, any>;

function parseArquivo(conteudo: string): Cliente[] {
  // Cada contato começa com "Contato N:" e termina antes do próximo "Contato N+1:".
  const blocos = conteudo
    .split(/\n(?=Contato\s+\d+:)/g)
    .map(b => b.trim())
    .filter(b => b.startsWith('Contato'));

  const lookup: Record<string, string> = {
    'ID': 'externo_id',
    'Código': 'codigo',
    'Codigo': 'codigo',
    'Nome': 'nome',
    'Fantasia': 'fantasia',
    'Endereço': 'endereco',
    'Endereco': 'endereco',
    'Número': 'numero',
    'Numero': 'numero',
    'Complemento': 'complemento',
    'Bairro': 'bairro',
    'CEP': 'cep',
    'Cidade': 'cidade',
    'UF': 'uf',
    'Fone': 'fone',
    'Celular': 'celular',
    'E-mail': 'email',
    'Email': 'email',
    'E-mail para envio NFe': 'email_nfe',
    'Contatos': 'contatos',
    'Tipo pessoa': 'tipo_pessoa',
    'CNPJ / CPF': 'cpf_cnpj',
    'CPF / CNPJ': 'cpf_cnpj',
    'CPF/CNPJ': 'cpf_cnpj',
    'IE / RG': 'ie_rg',
    'IE isento': 'ie_isento',
    'Situação': 'situacao',
    'Situacao': 'situacao',
    'Data nascimento': 'data_nascimento',
    'Tipo contato': 'tipo_contato',
    'Vendedor': 'vendedor',
    'Limite de crédito': 'limite_credito',
    'Limite de credito': 'limite_credito',
    'Cliente desde': 'cliente_desde',
    'Regime tributário': 'regime_tributario',
    'Regime tributario': 'regime_tributario',
    'Observações': 'observacoes',
    'Observacoes': 'observacoes',
  };

  const clientes: Cliente[] = [];
  for (const bloco of blocos) {
    const linhas = bloco.split(/\n/).map(l => l.trim()).filter(Boolean);
    const c: Cliente = {};
    for (const linha of linhas) {
      if (linha.startsWith('Contato ') || linha.startsWith('---')) continue;
      const idxColon = linha.indexOf(':');
      if (idxColon < 0) continue;
      const rawKey = fixMojibake(linha.slice(0, idxColon).trim());
      const rawVal = fixMojibake(linha.slice(idxColon + 1).trim());
      if (!rawVal) continue;

      const col = lookup[rawKey];
      if (!col) continue;

      if (col === 'cep') c[col] = parseCEP(rawVal);
      else if (col === 'limite_credito') c[col] = parseNumber(rawVal);
      else if (col === 'data_nascimento' || col === 'cliente_desde') c[col] = parseBRDate(rawVal);
      else c[col] = rawVal;
    }
    if (c.nome) clientes.push(c);
  }
  return clientes;
}

async function main() {
  console.log('Lendo arquivo:', ARQUIVO);
  if (!fs.existsSync(ARQUIVO)) {
    console.error(`Arquivo não encontrado: ${ARQUIVO}`);
    console.error('Salve o .txt de contatos em data/contatos_formatados.txt ou passe o caminho como argumento.');
    process.exit(1);
  }
  const conteudo = fs.readFileSync(ARQUIVO, 'utf-8');
  const clientes = parseArquivo(conteudo);
  console.log(`Parsing: ${clientes.length} contatos encontrados.`);
  if (clientes.length === 0) {
    console.error('Nenhum contato parseado. Confira o formato do arquivo.');
    process.exit(1);
  }

  // Garante existência da tabela. Roda só os DDLs essenciais (idempotentes).
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

    let inseridos = 0;
    let atualizados = 0;
    const cols = [
      'externo_id', 'codigo', 'nome', 'fantasia', 'tipo_pessoa', 'cpf_cnpj',
      'ie_rg', 'ie_isento', 'endereco', 'numero', 'complemento', 'bairro', 'cep',
      'cidade', 'uf', 'fone', 'celular', 'email', 'email_nfe', 'contatos',
      'data_nascimento', 'tipo_contato', 'vendedor', 'observacoes',
      'regime_tributario', 'cliente_desde', 'limite_credito', 'situacao',
    ];
    await c.query('BEGIN');
    for (const cl of clientes) {
      const valores = cols.map(k => cl[k] ?? null);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const updateSet = cols
        .filter(k => k !== 'externo_id' && k !== 'nome')
        .map(k => `${k} = COALESCE(EXCLUDED.${k}, clientes.${k})`)
        .join(', ');
      const { rows } = await c.query(
        `INSERT INTO clientes (${cols.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (externo_id) DO UPDATE
         SET nome = EXCLUDED.nome, ${updateSet}, atualizado_em = NOW()
         RETURNING (xmax = 0) AS inserted`,
        valores
      );
      if (rows[0]?.inserted) inseridos++;
      else atualizados++;
    }
    await c.query('COMMIT');
    console.log(`OK: ${inseridos} inseridos, ${atualizados} atualizados.`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Erro durante a importação:', e);
    process.exit(1);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
