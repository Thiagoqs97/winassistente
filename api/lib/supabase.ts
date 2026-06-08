import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client do Supabase usado SÓ pro Storage (imagens de produto). O banco relacional
// continua via `pg` puro (api/db/pool.ts) — este client não toca nas tabelas.
// Inicialização lazy: não cria side-effect no import (ex.: em testes/webhook).
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  // Pra ESCREVER no Storage server-side a service_role key é o caminho limpo
  // (a anon key exige policy de INSERT no bucket). Cai pra SUPABASE_KEY se a
  // service não estiver setada.
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_KEY (ou SUPABASE_SERVICE_KEY) são obrigatórios pro Storage.');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
