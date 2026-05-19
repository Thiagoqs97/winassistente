// Parsers determinísticos para mensagens do vendedor (sem LLM).
// Os retornos são usados para curto-circuitar fluxos comuns (onboarding,
// confirmações sim/não, escolha numerada de cliente).

import type { ClienteMatch } from './search.js';

// Onboarding: extrai o nome do vendedor a partir de mensagens livres.
// Aceita "João", "meu nome é Maria", "sou o Pedro", "aqui é a Ana".
// Rejeita textos que cheirem a pedido (números, frases longas).
export function parseNomeVendedor(text: string): string | null {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(
    /^(meu nome (e|é)\s*:?\s*|me chamo\s+|sou (o |a )?|aqui (e|é) (o |a )?|nome\s*:?\s*|eu sou (o |a )?)/i,
    ''
  ).trim();
  cleaned = cleaned.replace(/[.!?,;]+$/, '').trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (/\d/.test(cleaned)) return null;
  if (!/^[\p{L}][\p{L}\s'-]{1,}$/u.test(cleaned)) return null;
  const palavras = cleaned.split(/\s+/);
  if (palavras.length > 5) return null;
  return palavras
    .map(w => w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR'))
    .join(' ');
}

export function parseConfirmacao(text: string): 'sim' | 'nao' | 'ambiguo' {
  const t = text.trim().toLowerCase().replace(/[.!?,;]+$/, '');
  if (/^(sim|s|ok|pode|isso|confirma|confirmo|confirmar|positivo|claro|fecha|manda|vai|sim por favor|sim pode|com certeza|certeza)\b/.test(t)) return 'sim';
  if (/^(nao|não|n|negativo|cancela isso|esquece|deixa|nem|para|pare|errado|nao quero|não quero)\b/.test(t)) return 'nao';
  return 'ambiguo';
}

export type Escolha =
  | { kind: 'numero'; idx: number }
  | { kind: 'novo' }
  | { kind: 'cancela' }
  | { kind: 'ambiguo' };

export function parseEscolha(text: string, totalOpcoes: number): Escolha {
  const t = text.trim().toLowerCase().replace(/[.!?,;]+$/, '');
  if (/^(cancela|cancelar|esquece|deixa|para|nenhum|nenhuma|n[ãa]o quero|n[ãa]o)$/.test(t)) return { kind: 'cancela' };
  if (/\b(novo|nov[ao]\s+cliente|cadastra|cadastrar|criar|cria|cadastre)\b/.test(t)) return { kind: 'novo' };
  const numMatch = t.match(/^(\d{1,3})/);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    if (n >= 1 && n <= totalOpcoes) return { kind: 'numero', idx: n - 1 };
  }
  const ordinais: Record<string, number> = {
    'primeiro': 0, 'primeira': 0, 'primeiro um': 0, 'o primeiro': 0,
    'segundo': 1, 'segunda': 1, 'o segundo': 1,
    'terceiro': 2, 'terceira': 2, 'o terceiro': 2,
    'quarto': 3, 'quarta': 3,
    'quinto': 4, 'quinta': 4,
  };
  for (const [k, v] of Object.entries(ordinais)) {
    if (t.includes(k) && v < totalOpcoes) return { kind: 'numero', idx: v };
  }
  return { kind: 'ambiguo' };
}

export function formatClienteResumo(c: ClienteMatch | any): string {
  const partes: string[] = [];
  if (c.fantasia && c.fantasia.toLowerCase() !== String(c.nome).toLowerCase()) partes.push(c.fantasia);
  if (c.cpf_cnpj) partes.push(`CPF/CNPJ: ${c.cpf_cnpj}`);
  if (c.cidade) partes.push(`${c.cidade}${c.uf ? '/' + c.uf : ''}`);
  const sufixo = partes.length > 0 ? ` — ${partes.join(' — ')}` : '';
  return `${c.nome}${sufixo}`;
}

export function formatListaClientes(candidatos: ClienteMatch[]): string {
  return candidatos
    .map((c, i) => `${i + 1}. ${formatClienteResumo(c)}`)
    .join('\n');
}

// Comandos slash (Fase 4 — UX WhatsApp). Determinístico, antes do LLM.
// Aceita com ou sem barra ("ajuda" e "/ajuda" valem).
export type ComandoSlash = 'ajuda' | 'status';

export function parseComandoSlash(text: string): ComandoSlash | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^\/?(ajuda|help|comandos|menu)$/.test(t)) return 'ajuda';
  if (/^\/?status$/.test(t)) return 'status';
  return null;
}

// Normaliza "123" / "ORC-7" / "orc 45" → "ORC-000123"
export function normalizarNumeroOrcamento(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const digits = String(ref).replace(/\D/g, '');
  if (!digits) return null;
  return `ORC-${digits.padStart(6, '0')}`;
}
