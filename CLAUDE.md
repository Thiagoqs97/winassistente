# CLAUDE.md

Guia operacional do projeto **WIN Distribuidora — Assistente de Vendas WhatsApp**.
Este arquivo é a porta de entrada para qualquer sessão de trabalho. Leia ele inteiro antes de mexer no código.

## O que este sistema faz

Agente de IA que atende **representantes de venda da WIN Distribuidora pelo WhatsApp**, sem intermediário humano. Recebe pedidos (texto, áudio, imagem, PDF, planilha), busca produtos no estoque com busca fuzzy, confirma com o vendedor, e gera um orçamento numerado (ORC-000123). Também responde intents administrativas: listar orçamentos abertos, fechar como venda, cancelar, alterar, buscar por cliente, cadastrar/editar clientes.

Stack: **React 19 + Vite** (painel admin) · **Node 22 + Express + TypeScript** (backend, deploy serverless na Vercel) · **Supabase Postgres** (com `pg_trgm`, `unaccent`, `uuid-ossp`) · **Evolution API** (gateway WhatsApp) · **OpenAI** (GPT-4.1 para triagem/geração, GPT-4o para visão, Whisper para áudio).

## Como rodar

```bash
npm install          # primeira vez
npm run dev          # backend Express + Vite middleware em http://localhost:3000
npm run lint         # tsc --noEmit (checagem de tipos)
npm test             # vitest run (testes unitários)
npm run test:watch   # vitest em watch mode
npm run build        # build do frontend (Vite)
npm run build:all    # build frontend + bundle do servidor (esbuild)
npm run start        # roda o servidor bundled (produção self-hosted)
```

Variáveis em `.env` (modelo em `.env.example`):
- `OPENAI_API_KEY`
- `DATABASE_URL` — string completa do Supabase (sem `?` query params)
- `SUPABASE_URL`, `SUPABASE_KEY`
- `EVO_URL`, `EVO_INSTANCE`, `EVO_APIKEY`, `GLOBAL_EVO_APIKEY`
- `VITE_APP_URL` — URL pública (usada na configuração do webhook do Evolution)
- `JWT_SECRET` — segredo do JWT do painel (≥32 chars); gere com `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ADMIN_INITIAL_EMAIL` + `ADMIN_INITIAL_PASSWORD` — credenciais do admin inicial criadas no primeiro boot se a tabela `users` estiver vazia (senha ≥8 chars)

## Deploy

- Hospedado em **Vercel** (`https://winassistente.vercel.app`, projeto `tthoficials-projects/winassistente`).
- Push em `main` no GitHub (`Thiagoqs97/winassistente`) dispara deploy automático.
- Webhook do Evolution aponta para `${VITE_APP_URL}/api/webhook/evolution`. Reconfigurar pela tela Configurações no painel se mudar a URL.

## Onde mexer pra cada coisa

| Mexer em… | Arquivo |
|---|---|
| Bootstrap Express + middlewares + montagem de routers | `api/server.ts` |
| Entry point Vercel | `api/index.ts` (só re-exporta `server.ts`) |
| Pool pg | `api/db/pool.ts` |
| Migrations / schema (DDL idempotente, `ensureDB()`) | `api/db/migrations.ts` |
| Busca fuzzy (produtos e clientes) | `api/services/search.ts` |
| Gerar / alterar orçamento, resolver cliente | `api/services/orcamentos.ts` |
| Enviar mensagem WhatsApp | `api/services/whatsapp.ts` |
| Parsers determinísticos (sim/não, ordinais, nome, normalização ORC) | `api/services/intents.ts` |
| Whisper / Vision / xlsx / csv | `api/services/media.ts` |
| Prompts do extrator e do agente final | `api/agents/prompts.ts` |
| Definições de tools (function calling) | `api/agents/tools.ts` |
| Webhook do Evolution (pipeline principal) | `api/routes/webhook.ts` |
| REST do painel | `api/routes/{products,clientes,orcamentos,vendedores,config,setup}.ts` |
| OpenAI client singleton | `api/lib/openai.ts` |
| Wrapper de chat completion + tracking de custo em `ai_usage` | `api/lib/ai.ts` |
| Logger estruturado | `api/lib/logger.ts` |
| Auth (bcrypt, JWT, permissões) | `api/lib/auth.ts` |
| Middleware (requireAuth, requirePermission) | `api/middleware/auth.ts` |
| Routes auth (login, logout, me) | `api/routes/auth.ts` |
| Routes users (CRUD admin-only) | `api/routes/users.ts` |
| UI do painel (single-page por enquanto) | `src/App.tsx` |
| Auth no frontend (Context + LoginScreen) | `src/auth/` |
| Permissões espelhadas no frontend | `src/lib/permissions.ts` |
| Wrapper de fetch (credentials, 401 handling) | `src/lib/install-fetch.ts`, `src/lib/api.ts` |
| Estilo Tailwind | `src/index.css` (Tailwind v4) |
| Build / deploy config | `vite.config.ts`, `vercel.json` |
| Testes | `tests/*.test.ts`, `vitest.config.ts` |

## Convenções de código

- **TypeScript estrito**: `"isolatedModules": true`, `"noEmit": true`. Tudo que for adicionado segue typecheck via `npm run lint`.
- **ESM em todo lugar**: `"type": "module"` no `package.json`. Imports relativos terminam em `.js` (mesmo apontando para `.ts`) porque o servidor é bundled por esbuild com `--format=cjs` mas o dev usa tsx ESM.
- **Sem JSX em servidor**, sem CommonJS em frontend.
- **Português do Brasil** em mensagens ao usuário (vendedor) e em strings que aparecem no painel.
- **Comentários só pra o WHY não-óbvio**. Não comente o WHAT.
- **SQL em template strings**, parametrizado (`$1`, `$2`). Nada de string concatenation.
- **Nomes em pt-BR no banco**: `vendedores`, `sessoes`, `mensagens`, `orcamentos`, `clientes`. Manter o padrão.
- **WhatsApp markdown**: negrito é `*texto*` (UM asterisco). NUNCA `**texto**`. Sem tabela `|`. Listas com número simples (`1. `, `2. `).
- **IDs**: produtos = `SERIAL` (int). Demais entidades = `UUID` via `uuid-ossp`.
- **Schema migrations**: hoje rodam idempotentemente no boot (`CREATE IF NOT EXISTS` + `ALTER ADD COLUMN IF NOT EXISTS`). Quando houver mudança destrutiva, abrir migration versionada (ver `docs/DECISIONS.md`).

## Modelo de auth (Fase 1a)

- **Roles**: `admin` (vê tudo, todas as permissões implícitas) e `sub` (granular via `permissions` array).
- **Vinculação a vendedor**: `users.vendedor_id → vendedores.id` (opcional). Quando preenchido E o role é `sub`, dispara **isolamento por vendedor** em:
  - `GET /api/orcamentos` — filtra `vendedor_id = user.vendedor_id`
  - `GET /api/orcamentos/:numero` — 404 se o orçamento não for do user
  - `PATCH /api/orcamentos/:numero/{fechar,cancelar,reabrir}` — 404 se não for do user
  - `GET /api/vendedores` — só retorna o próprio
  - `GET /api/vendedores/:vendedorId/sessoes` — 403 se não for o próprio
  - `GET /api/sessoes/:sessaoId/mensagens` — 403 se a sessão não for sua
- **Permissões granulares** (`api/lib/auth.ts:PERMISSIONS`): `products.view/edit/import`, `clientes.view/edit/delete`, `orcamentos.view/edit`, `vendas.view`, `vendedores.view/edit`, `historico.view`, `config.view/edit`, `dashboard.view`, `users.manage`.
- **Webhook** (`/api/webhook/evolution`) **não** passa por auth — o Evolution chama com `apikey` próprio.
- **JWT** em cookie httpOnly (`win_auth`), 7d de expiração. Frontend usa `credentials: 'include'` via patch global em `src/lib/install-fetch.ts`.
- **Em 401** o frontend dispara `auth-expired` e o `AuthContext` força logout no estado local.

## Coisas que parecem bugs mas são intencionais

- **`extractedTerms` é montado por uma chamada SEPARADA da resposta final** (`gpt-4.1` em modo JSON, `temperature: 0`). Razão: determinismo + impede que o modelo "responda" como chatbot na fase de busca.
- **`MAX_PER_TERM = 30` em `searchProducts`**: alto de propósito. Quando o vendedor pergunta "quais sabores do X?", precisamos retornar TODAS as variações. O prompt instrui o agente a listar 100% do grupo. NÃO baixe isso sem entender o impacto na conversa.
- **`sml` da Strategy 3** (keyword AND): força `(0.3 + bônus)`. Sobreescreve o `sml` da Strategy 1+2 só se for maior. Isso permite que `"creatina dux 300g"` encontre `"CREATINA DUX 300 GRAMAS"` mesmo com similaridade lexical baixa.
- **`acao_pendente` em `sessoes`** (JSONB): guarda o estado de uma confirmação em curso (fechar venda, cancelar, escolher cliente entre múltiplos matches, escolher cliente p/ edição). É consumido na próxima mensagem do vendedor e limpo. Ver `docs/FLOWS.md`.
- **Onboarding bloqueia o vendedor até informar o nome**. Toda a triagem só corre quando `vendedores.nome IS NOT NULL`. O parser `parseNomeVendedor` é estrito: rejeita números, frases longas, palavras com dígito.
- **`remoteJidAlt` é preferido ao `remoteJid`** quando termina em `@s.whatsapp.net` — algumas contas Business vêm com `@lid` no remoteJid e o número real no alt.

## Custos e modelos de IA

| Uso | Modelo | Por quê |
|---|---|---|
| Triagem / extrator de intent + termos | `gpt-4.1` | JSON strict mode + temp 0; precisa entender contexto multi-msg |
| Resposta final (com tools) | `gpt-4.1` | Tool calling de `finalizar_orcamento`, `alterar_orcamento`, `cadastrar_cliente`, `editar_cliente` |
| Visão (imagem com lista de pedidos) | `gpt-4o` | Multimodal |
| Transcrição de áudio | `whisper-1` | PT |

Substituição planejada do extrator para um modelo menor está no roadmap (não nesta fase).

## Tipos de mensagem suportados no WhatsApp

| Tipo | Como vem | Processamento |
|---|---|---|
| Texto | `msg.conversation` ou `msg.extendedTextMessage.text` | Vai direto pro extractor |
| Áudio (`audioMessage`) | base64 em `msg.base64` | Whisper → texto → extractor |
| Imagem (`imageMessage`) | base64 em `msg.base64` | GPT-4o vision → "Produto - Quantidade" → extractor |
| Planilha (`.xlsx/.xls` em `documentMessage`) | base64 | `xlsx` lib → `header: 1` rows → string `"linha 1 \| linha 2 \| ..."` |
| CSV (`documentMessage`) | base64 | Decode UTF-8 (até 4000 chars) → string |
| PDF | (ainda não implementado, declarado em `tipo_midia` mas não processado) | — |

## Roadmap aprovado (resumo)

- **Fase 0** (atual): documentação, modularização, logger, testes, limpeza.
- **Fase 1**: auth no painel (admin + sub-logins com permissões granulares) + tracking de custo de IA.
- **Fase 2**: dashboard BI completo (faturamento, ranking vendedores, top produtos, clientes, funil, custo IA).
- **Fase 3**: histórico de compras do cliente (endpoint + base) + geração de PDF do orçamento.
- **Fase 4**: UX no WhatsApp (`/ajuda`, `/status`, `/historico cliente`, PDF anexo, alerta de mudança de preço).

Detalhes e dependências em `docs/ROADMAP.md` (criado junto com o PRD v3.0).

## Documentação complementar

| Arquivo | Conteúdo |
|---|---|
| `pdr-win-assistente.md` | PRD v3.0 — visão de produto |
| `docs/ARCHITECTURE.md` | Diagrama lógico do sistema |
| `docs/SCHEMA.md` | Esquema completo do banco |
| `docs/FLOWS.md` | Fluxos críticos (orçamento, alteração, ações pendentes) |
| `docs/DECISIONS.md` | Decisões arquiteturais (ADR-style) |
| `docs/PDF_ORCAMENTO.md` | Template do PDF do orçamento |
| `docs/ROADMAP.md` | Fases aprovadas, entregáveis, ordem |

## Política de mudanças

1. Sempre rode `npm run lint` (typecheck) antes de commit.
2. Para mudança de schema: nunca SQL destrutivo sem migration versionada (`api/db/migrations/NNN_descricao.sql`).
3. Pra ações com efeito além do repo (deploy, push, alterar dados em prod), o autor da mudança avisa antes mesmo quando autorizado.
4. PRs/commits no padrão atual (`feat:`, `fix:`, `chore:`, ...) — ver `git log`.
5. Após cada fase concluída, atualizar este arquivo + o `docs/` relevante.

## Glossário rápido

- **Sessão**: ciclo de atendimento de um vendedor (1 sessão ativa por vendedor). Encerra por timeout (`session_timeout_hours` em `system_config`) ou ação explícita do vendedor.
- **Vendedor**: representante de venda — identificado pelo número de WhatsApp.
- **Cliente**: comprador final da WIN (PJ ou PF) — base importada do Tiny/Bling.
- **Orçamento**: documento numerado (ORC-NNNNNN) com itens, totais e status (`aberto`/`venda`/`cancelado`).
- **Ação pendente** (`acao_pendente` em `sessoes`): estado intermediário aguardando confirmação ou escolha do vendedor.
- **Intent**: classificação do que o vendedor quer (`pedido`, `listar_abertos`, `buscar_por_cliente`, `fechar_venda`, `cancelar_orcamento`, `alterar_orcamento`, `outro`).
