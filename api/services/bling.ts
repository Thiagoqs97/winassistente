import axios, { AxiosError } from 'axios';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

// OAuth fica em www.bling.com.br; a API de recursos em api.bling.com.br (v3).
const OAUTH_BASE = 'https://www.bling.com.br/Api/v3/oauth';
const API_BASE = 'https://api.bling.com.br/Api/v3';

function basicAuthHeader(): string {
  const id = process.env.BLING_CLIENT_ID ?? '';
  const secret = process.env.BLING_CLIENT_SECRET ?? '';
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export function getAuthorizeUrl(state: string): string {
  // redirect_uri e scope saem do que está cadastrado no app do Bling.
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.BLING_CLIENT_ID ?? '',
    state,
  });
  return `${OAUTH_BASE}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const { data } = await axios.post<TokenResponse>(
    `${OAUTH_BASE}/token`,
    new URLSearchParams(body).toString(),
    {
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    },
  );
  return data;
}

async function saveTokens(t: TokenResponse): Promise<void> {
  // Marca o vencimento 60s antes do real pra evitar corrida na borda.
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
  await pool.query(
    `INSERT INTO bling_auth (id, access_token, refresh_token, expires_at, scope, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       expires_at = EXCLUDED.expires_at,
       scope = EXCLUDED.scope,
       updated_at = now()`,
    [t.access_token, t.refresh_token, expiresAt.toISOString(), t.scope ?? null],
  );
}

export async function exchangeCode(code: string): Promise<void> {
  const t = await requestToken({ grant_type: 'authorization_code', code });
  await saveTokens(t);
  logger.info('Bling: conectado (authorization_code)');
}

interface AuthRow {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

async function readAuth(): Promise<AuthRow | undefined> {
  const { rows } = await pool.query<AuthRow>(
    'SELECT access_token, refresh_token, expires_at FROM bling_auth WHERE id = 1',
  );
  return rows[0];
}

export async function getConnectionStatus(): Promise<{ connected: boolean; expiresAt: string | null }> {
  const row = await readAuth();
  return { connected: !!row?.refresh_token, expiresAt: row?.expires_at ?? null };
}

async function refreshAndStore(refreshToken: string): Promise<string> {
  const t = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  await saveTokens(t);
  logger.info('Bling: token renovado');
  return t.access_token;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  const row = await readAuth();
  if (!row?.refresh_token) {
    throw new Error('Bling não conectado — autorize o app primeiro.');
  }
  const expired = !row.expires_at || new Date(row.expires_at).getTime() <= Date.now();
  if (forceRefresh || expired || !row.access_token) {
    return refreshAndStore(row.refresh_token);
  }
  return row.access_token;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function blingGet<T = unknown>(path: string, params?: Record<string, string | number>): Promise<T> {
  let token = await getAccessToken();
  let refreshedOn401 = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const { data } = await axios.get<T>(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params,
      });
      return data;
    } catch (e) {
      const err = e as AxiosError;
      const status = err.response?.status;
      if (status === 429) {
        await sleep(1000 * (attempt + 1)); // backoff no rate limit (3 req/s)
        continue;
      }
      if (status === 401 && !refreshedOn401) {
        refreshedOn401 = true;
        token = await getAccessToken(true);
        continue;
      }
      throw new Error(
        `Bling GET ${path} -> ${status ?? err.code}: ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
    }
  }
  throw new Error(`Bling GET ${path}: excedeu retries (rate limit).`);
}

export interface BlingProduto {
  id: number;
  nome: string;
  codigo: string | null;
  gtin: string | null;
}

interface ProdutosPage {
  data?: Array<{ id: number; nome: string; codigo?: string | null; gtin?: string | null }>;
}

// Itera TODOS os produtos do Bling, respeitando o limite de ~3 req/s.
export async function* iterateProdutos(): AsyncGenerator<BlingProduto> {
  let pagina = 1;
  for (;;) {
    const page = await blingGet<ProdutosPage>('/produtos', { pagina, limite: 100 });
    const items = page.data ?? [];
    for (const p of items) {
      yield { id: p.id, nome: p.nome, codigo: p.codigo ?? null, gtin: p.gtin ?? null };
    }
    if (items.length < 100) break;
    pagina++;
    await sleep(350);
  }
}

export interface ProdutoDetalhe {
  data?: {
    id?: number;
    nome?: string;
    codigo?: string;
    imagemURL?: string;
    midia?: {
      imagens?: {
        externas?: unknown[];
        internas?: unknown[];
        imagensURL?: unknown[];
      };
    };
    // O detalhe traz o estoque do produto — usado pelo inspetor (/bling/sample)
    // pra confirmar o scope/shape antes de rodar o sync em massa via /estoques/saldos.
    estoque?: {
      saldoFisicoTotal?: number;
      saldoVirtualTotal?: number;
    };
  };
}

// Detalhe de um produto — é aqui que vem a midia/imagens. Exposto pro sync e
// pro inspector (/bling/sample).
export async function getProdutoDetalhe(id: number): Promise<ProdutoDetalhe> {
  return blingGet<ProdutoDetalhe>(`/produtos/${id}`);
}

// Pega a 1a URL http de um array que pode conter strings OU objetos com a URL
// em algum campo conhecido (link/url/imageUrl/src). Defensivo: a estrutura
// exata de cada imagem do Bling varia entre externas/internas/imagensURL.
function primeiraUrl(arr: unknown): string | null {
  if (!Array.isArray(arr)) return null;
  for (const item of arr) {
    if (typeof item === 'string' && item.startsWith('http')) return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const cand = o.link ?? o.url ?? o.imageUrl ?? o.src;
      if (typeof cand === 'string' && cand.startsWith('http')) return cand;
    }
  }
  return null;
}

// Extrai a URL da imagem do detalhe. Externas primeiro (catálogo/público),
// depois imagensURL, depois internas, e por fim o imagemURL legado.
export function extrairImagemUrl(d: ProdutoDetalhe): string | null {
  const imgs = d?.data?.midia?.imagens;
  return (
    primeiraUrl(imgs?.externas) ??
    primeiraUrl(imgs?.imagensURL) ??
    primeiraUrl(imgs?.internas) ??
    (d?.data?.imagemURL && d.data.imagemURL.startsWith('http') ? d.data.imagemURL : null)
  );
}

// Saldo (virtual, vendável) extraído do detalhe do produto. Fallback pro físico.
// Usado pelo inspetor /bling/sample; o sync em massa usa getSaldosEstoque.
export function extrairSaldo(d: ProdutoDetalhe): number | null {
  const e = d?.data?.estoque;
  if (!e) return null;
  if (typeof e.saldoVirtualTotal === 'number') return e.saldoVirtualTotal;
  if (typeof e.saldoFisicoTotal === 'number') return e.saldoFisicoTotal;
  return null;
}

export interface SaldoEstoque {
  produtoId: number;
  saldoFisico: number | null;
  saldoVirtual: number | null;
}

interface SaldoRow {
  produto?: { id?: number };
  saldoFisicoTotal?: number;
  saldoVirtualTotal?: number;
  depositos?: Array<{ id?: number; saldoFisico?: number; saldoVirtual?: number }>;
}

export interface SaldosPage {
  data?: SaldoRow[];
}

// Total de um campo de saldo: prefere o *Total do topo; senão soma os depósitos.
function totalSaldo(row: SaldoRow, campo: 'saldoFisico' | 'saldoVirtual'): number | null {
  const top = row[`${campo}Total` as 'saldoFisicoTotal' | 'saldoVirtualTotal'];
  if (typeof top === 'number') return top;
  const deps = row.depositos;
  if (Array.isArray(deps)) {
    let soma = 0;
    let achou = false;
    for (const d of deps) {
      const v = d?.[campo];
      if (typeof v === 'number') {
        soma += v;
        achou = true;
      }
    }
    if (achou) return soma;
  }
  return null;
}

// Parse defensivo da resposta do /estoques/saldos. Pula linhas sem produto.id.
// Pra cada produto: total do topo quando vier, senão soma dos depósitos. Pure
// (sem HTTP) pra ser testável — a estrutura do Bling varia entre contas.
export function parseSaldosResponse(page: SaldosPage): SaldoEstoque[] {
  const out: SaldoEstoque[] = [];
  for (const row of page.data ?? []) {
    const produtoId = row.produto?.id;
    if (typeof produtoId !== 'number') continue;
    out.push({
      produtoId,
      saldoFisico: totalSaldo(row, 'saldoFisico'),
      saldoVirtual: totalSaldo(row, 'saldoVirtual'),
    });
  }
  return out;
}

// Saldo de estoque de um lote de produtos (GET /estoques/saldos). idsProdutos[]
// repetido na query; idDeposito opcional restringe a um depósito (sem ele vêm os
// totais). Devolve saldo físico e virtual por produto retornado.
export async function getSaldosEstoque(ids: number[], idDeposito?: number): Promise<SaldoEstoque[]> {
  if (ids.length === 0) return [];
  const qs = new URLSearchParams();
  for (const id of ids) qs.append('idsProdutos[]', String(id));
  if (idDeposito) qs.append('idDeposito', String(idDeposito));
  const page = await blingGet<SaldosPage>(`/estoques/saldos?${qs.toString()}`);
  return parseSaldosResponse(page);
}
