# WIN Distribuidora — Assistente de Vendas WhatsApp

Sistema autônomo de atendimento a representantes de vendas pelo WhatsApp, com agente de IA que entende pedidos em texto/áudio/imagem/planilha, faz busca fuzzy no estoque e gera orçamentos sem intervenção humana. Inclui painel administrativo (React) para gestão de estoque, clientes, histórico, orçamentos, vendas e configurações.

Stack: **React 19 + Vite** · **Node 22 + Express + TypeScript** · **Supabase Postgres** · **Evolution API** · **OpenAI (gpt-4.1, gpt-4o, whisper-1)** · deploy na **Vercel**.

## Documentação

Comece pelo **[`CLAUDE.md`](CLAUDE.md)** — guia operacional com comandos, convenções e onde mexer em cada coisa.

| Documento | Conteúdo |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Guia operacional (porta de entrada) |
| [`pdr-win-assistente.md`](pdr-win-assistente.md) | PRD v3.0 |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arquitetura lógica e pipeline da mensagem |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Esquema do banco |
| [`docs/FLOWS.md`](docs/FLOWS.md) | Fluxos críticos passo-a-passo |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | ADRs |
| [`docs/PDF_ORCAMENTO.md`](docs/PDF_ORCAMENTO.md) | Template do PDF |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Fases 0–4 |

## Quickstart

```bash
npm install
cp .env.example .env   # preencher OPENAI_API_KEY, DATABASE_URL, EVO_*, VITE_APP_URL
npm run dev            # http://localhost:3000
```

## Scripts

| Comando | Função |
|---|---|
| `npm run dev` | Backend Express + Vite middleware (dev) |
| `npm run lint` | Typecheck TypeScript (`tsc --noEmit`) |
| `npm run build` | Build do frontend |
| `npm run build:all` | Build frontend + bundle do servidor |
| `npm run start` | Roda o servidor bundled |

## Deploy

- Push em `main` no GitHub dispara deploy automático na Vercel.
- Webhook do Evolution deve apontar para `${VITE_APP_URL}/api/webhook/evolution`. Reconfigurar pelo painel em **Configurações → Configurar Webhook Agora**.
