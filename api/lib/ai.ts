// Wrapper de chamadas OpenAI que registra usage e custo em `ai_usage`.
// Cobre apenas chat completions (modelos com `usage.{prompt_tokens, completion_tokens}`).
// Whisper não expõe tokens — fica fora deste tracking por enquanto.

import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { openai } from './openai.js';
import { pool } from '../db/pool.js';
import { logger } from './logger.js';

// Preço por 1M tokens (USD). Snapshot persistido em `cost_usd` na hora da call.
// Atualizar quando a OpenAI mexer nos valores. Modelos não listados = custo 0
// (registrado, mas custo zero — força revisão no log).
const PRICING_PER_MTOKEN: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

export type AiPurpose = 'extract' | 'final' | 'vision' | string;

export interface AiCallMeta {
  vendedorId?: string | null;
  sessaoId?: string | null;
  mensagemId?: string | null;
  purpose: AiPurpose;
}

function computeCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICING_PER_MTOKEN[model];
  if (!price) {
    logger.warn('ai_usage: modelo sem pricing cadastrado', { model });
    return 0;
  }
  const cost = (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

async function recordUsage(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined | null,
  meta: AiCallMeta
): Promise<void> {
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const total = usage?.total_tokens ?? prompt + completion;
  const cost = computeCostUsd(model, prompt, completion);
  try {
    await pool.query(
      `INSERT INTO ai_usage
       (vendedor_id, sessao_id, mensagem_id, model, purpose, prompt_tokens, completion_tokens, total_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        meta.vendedorId || null,
        meta.sessaoId || null,
        meta.mensagemId || null,
        model,
        meta.purpose,
        prompt,
        completion,
        total,
        cost,
      ]
    );
  } catch (err) {
    // Não bloqueia a resposta ao vendedor por falha de tracking.
    logger.error('ai_usage insert failed', { err: (err as Error).message, model, meta });
  }
}

export async function chatComplete(
  params: ChatCompletionCreateParamsNonStreaming,
  meta: AiCallMeta
): Promise<ChatCompletion> {
  const resp = await openai.chat.completions.create(params);
  // Fire-and-forget — não awaita pra não atrasar a próxima etapa.
  void recordUsage(params.model, resp.usage, meta);
  return resp;
}
