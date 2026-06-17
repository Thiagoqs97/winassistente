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
| Endpoints do dashboard BI (Fase 2) | `api/routes/dashboard.ts` + `api/services/dashboard.ts` |
| Histórico do cliente (Fase 3.1) | `GET /api/clientes/:id/historico` em `api/routes/clientes.ts` |
| Gerador de PDF do orçamento (download no painel) | `api/services/pdf.ts` (PDFKit) + endpoint `GET /api/orcamentos/:numero/pdf` |
| Gerador de imagem(s) PNG do orçamento (anexo do WhatsApp) | `api/services/imagem-orcamento.ts` (Satori + @resvg/resvg-js); paginação ~15 itens/PNG; fontes em `public/fonts/inter-{400,700}.woff` |
| Envio de documento via Evolution | `sendWhatsAppDocument` em `api/services/whatsapp.ts` |
| Envio de imagem inline via Evolution | `sendWhatsAppImage` em `api/services/whatsapp.ts` |
| Comandos slash `/ajuda` e `/status` (Fase 4 — 5.2/5.3) | `parseComandoSlash` em `api/services/intents.ts`; pré-handlers em `api/routes/webhook.ts` |
| Histórico do cliente no WhatsApp (Fase 4 — 5.4) | intent `historico_cliente` no extractor + handler em `api/routes/webhook.ts` |
| Alerta de variação de preço (Fase 4 — 5.5) | `api/services/precos.ts` + injeção em `buildStockContext` em `api/agents/prompts.ts` |
| Integração Bling (OAuth + sync produtos/imagem/estoque) | `api/services/bling.ts` (HTTP/token) + `api/services/bling-sync.ts` (diagnóstico/mapear/imagens/estoque) + `api/routes/bling.ts` |
| Webhook do Bling (estoque em tempo real) | `POST /api/bling/webhook` em `api/routes/bling.ts` (PÚBLICO, valida HMAC `verifyBlingSignature`); aplica saldo via `aplicarEstoqueWebhook` reusando `parseSaldosResponse`. `rawBody` capturado no `express.json` (`api/server.ts`) |
| Kanban (funil de negócios) — lógica de estágio | `api/services/negocios.ts` (upsert por sessão, avançar estágio forward-only, vincular ORC, sync status) |
| Kanban — REST (lista/mover/arquivar) | `api/routes/negocios.ts`: `GET /api/negocios`, `PATCH /api/negocios/:id/{estagio,arquivar}` |
| Kanban — UI arrasta-e-solta | `src/KanbanBoard.tsx` (HTML5 drag-and-drop + polling 12s; `<select>` de fallback no mobile) |
| Catálogo público `/loja` — vitrine/pedido (backend) | `api/services/loja.ts` + `api/routes/loja.ts` (GET produtos/categorias/marcas PÚBLICOS; `POST /loja/pedido` exige conta de cliente via `requireCliente`) |
| Catálogo público `/loja` — UI (vitrine + carrinho + checkout) | `src/loja/Loja.tsx`; UI compartilhada (ícones/`brl`/`BTN_OURO`/`Wordmark`) em `src/loja/ui.tsx`; carrinho persistido em localStorage |
| Conta do cliente final — auth (e-mail+senha, cookie `win_cliente`, claim `typ:'cliente'`) | `api/lib/cliente-auth.ts` + `api/middleware/cliente-auth.ts` (`requireCliente`) |
| Conta do cliente final — service + REST | `api/services/conta.ts` + `api/routes/conta.ts` (`registrar`/`login`/`logout`/`me`/`perfil`/`pedidos`/`enderecos` CRUD), montado na área PÚBLICA do `server.ts` |
| Conta do cliente final — UI (login/cadastro + painel) | `src/loja/conta/` (`ContaContext`, `Entrar`, `MinhaConta`); roteamento client-side em `src/loja/nav.ts` + `src/loja/LojaApp.tsx` (`/loja`, `/loja/entrar`, `/loja/conta`) |
| Helper de período (de/ate, default mês atual) | `api/lib/period.ts` |
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
- **Permissões granulares** (`api/lib/auth.ts:PERMISSIONS`): `products.view/edit/import`, `clientes.view/edit/delete`, `orcamentos.view/edit`, `kanban.view`, `vendas.view`, `vendedores.view/edit`, `historico.view`, `config.view/edit`, `dashboard.view`, `users.manage`.
- **Kanban**: ver o quadro exige `kanban.view`; mover/arrastar cartão exige `orcamentos.edit` (porque altera o status real do ORC). Isolamento por vendedor também vale em `GET/PATCH /api/negocios`.
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
- **Rodapé do PDF fica acima de `page.height - margins.bottom`**, não em `page.height - 30`. Caso contrário, o `LineWrapper` do PDFKit cria página adicional ao escrever lá (mesmo com `lineBreak: false`). Ver `api/services/pdf.ts`.
- **`negocios` é ancorado em `sessao_id` (UNIQUE), não no cliente nem no ORC**. Um cartão do Kanban = uma conversa/sessão. Nasce em `novo_contato` no 1º contato e avança SÓ pra frente automaticamente (`avancarEstagioAuto`); ir pra trás só por arraste manual ou conversa explícita. `expedicao` e `recebido` ambos correspondem a ORC `venda` — a diferença vive só em `negocios.estagio`. Por isso `syncEstagioPorStatusOrc` preserva `recebido` quando o status vira `venda`.
- **Arrastar um cartão altera o status REAL do orçamento** (decisão de produto): `estagioParaStatusOrc` mapeia coluna→status e o `PATCH /negocios/:id/estagio` propaga pro ORC. Estágios pré-ORC (`novo_contato`/`em_andamento`) não têm ORC, então não propagam nada.
- **A conta do cliente final É um registro de `clientes`** (não há tabela `cliente_users` separada): o cadastro grava `senha_hash` + `conta_criada_em` no próprio registro. `clientes` importados do Bling/Tiny ficam com `senha_hash NULL` e não são logáveis até alguém assumir.
- **CPF/CNPJ é OBRIGATÓRIO no cadastro e é a chave de vínculo** (`cpfCnpjValido` valida dígito verificador): se o documento bate com um `clientes` SEM conta, o cadastro ASSUME aquele registro (pega `senha_hash`) e herda todo o histórico — os pedidos já apontam pro `clientes.id`. Match SÓ por documento normalizado (`regexp_replace` só-dígitos), não por telefone/e-mail. **1 documento = 1 conta**: se o documento já tem conta (`senha_hash NOT NULL`), o cadastro é bloqueado e manda logar. Índices únicos **parciais** (`WHERE senha_hash IS NOT NULL`) em `lower(email)` e no documento normalizado garantem isso sem conflitar com a base importada (docs/e-mails repetidos/vazios).
- **Auth do cliente é SEPARADA da do painel**: cookie `win_cliente` (não `win_auth`) e JWT com claim `typ:'cliente'`. `verifyClienteToken` rejeita tokens sem esse claim, então um token de admin não vira sessão de cliente nem vice-versa, mesmo compartilhando `JWT_SECRET`.
- **Checkout do catálogo EXIGE conta** (decisão de produto): `POST /loja/pedido` passa por `requireCliente` e o pedido usa o `cliente.id` do cookie — não confia em nome/telefone do corpo. O carrinho fica em localStorage pra sobreviver ao desvio pro login.
- **Recuperação de senha + confirmação de e-mail estão PLANEJADAS mas PARADAS** (decisão do dono 2026-06-17): serão por **e-mail via Resend**, com **código** (mesmo fluxo pros dois) e confirmação **obrigatória** no cadastro. Bloqueadas hoje porque falta provedor/domínio: o Resend sem domínio verificado só envia pro próprio e-mail da conta (modo teste) e validar domínio exige acesso ao DNS de `windistribuidora.com` (que o dono não tem agora). Quando houver domínio: criar tabela de códigos (tipo `cliente_codigos` com hash+expiração+tentativas), service de envio, endpoints e a UI. NÃO usar o Auth do Supabase (jogaria fora o vínculo por CNPJ/`clientes`).

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

## Dashboard BI (Fase 2)

- Tab **Dashboard** no painel (primeira da sidebar). Permissão: `dashboard.view`.
- Sub-login com `vendedor_id` vê só os próprios números (mesmo isolamento de orçamentos). Admin e sub sem vínculo veem tudo.
- Filtro de período via query string `?de=YYYY-MM-DD&ate=YYYY-MM-DD` (default: mês atual). `ate` é inclusivo no input; o helper devolve right-open (`ate` exclusivo) pra comparações `< $2`.
- Endpoints, todos sob `requirePermission('dashboard.view')`:
  - `GET /api/dashboard/kpis` — faturamento, ticket médio, conversão, # orçamentos (por status).
  - `GET /api/dashboard/ranking-vendedores` — top 50 ordenado por faturamento; inclui tempo médio entre `criado_em` e `atualizado_em` quando status='venda'.
  - `GET /api/dashboard/top-produtos` — mais vendidos, cotados sem venda (status='cancelado'), encalhados (produtos ativos sem aparição em orçamentos nos últimos 90 dias). Agrega via `jsonb_array_elements(orcamentos.itens)` por `(descricao, marca)` — não há FK pra `products` dentro do JSON.
  - `GET /api/dashboard/clientes` — top compradores no período, inativos (sem venda há >60 dias, sinal absoluto não-relativo ao filtro), curva ABC (80/15/5).
  - `GET /api/dashboard/funil` — mensagens recebidas → orçamentos → vendas + taxas.
  - `GET /api/dashboard/custo-ia` — total tokens/USD/calls, breakdown por modelo, por purpose e top 20 por vendedor (lendo `ai_usage`).

## Roadmap aprovado (resumo)

- **Fase 0** ✅: documentação, modularização, logger, testes, limpeza.
- **Fase 1** ✅: auth no painel (admin + sub-logins com permissões granulares) + tracking de custo de IA.
- **Fase 2** ✅: dashboard BI completo (faturamento, ranking vendedores, top produtos, clientes, funil, custo IA).
- **Fase 3** ✅: histórico de compras do cliente (endpoint + modal no painel) + geração de PDF do orçamento (PDFKit + endpoint + download no painel).
- **Fase 4** ✅: UX no WhatsApp (`/ajuda`, `/status`, histórico do cliente via intent natural, PDF anexo automático, alerta de mudança de preço).

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
- **Negócio** (`negocios`): um cartão do Kanban = uma conversa/sessão. Tem um `estagio` (coluna do funil) e, depois de gerado, vincula o orçamento.
- **Estágio**: coluna do funil — `novo_contato`, `em_andamento`, `orcamento`, `expedicao`, `recebido`, `cancelado`.
- **Intent**: classificação do que o vendedor quer (`pedido`, `listar_abertos`, `buscar_por_cliente`, `historico_cliente`, `fechar_venda`, `cancelar_orcamento`, `alterar_orcamento`, `marcar_expedicao`, `marcar_recebido`, `outro`).
