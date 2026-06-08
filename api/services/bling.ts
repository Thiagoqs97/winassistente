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
