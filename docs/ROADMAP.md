# Roadmap — WIN Distribuidora v3

Planejamento aprovado em maio/2026. Sequência **0 → 1 → 2 → 3 → 4** definida pelos princípios:
1. Fundação primeiro (sem dívida técnica nas próximas fases).
2. Risco antes de feature (auth do painel é um buraco hoje).
3. Dependências respeitadas (UX no WhatsApp depende de BI e de histórico).

## Fase 0 — Fundação e contexto

**Objetivo:** preparar terreno para todas as fases seguintes. Sem feature de usuário final.

Entregáveis:
- [x] `CLAUDE.md` na raiz.
- [x] `docs/ARCHITECTURE.md`, `SCHEMA.md`, `FLOWS.md`, `DECISIONS.md`, `PDF_ORCAMENTO.md`, `ROADMAP.md`.
- [x] PRD v3.0 (atualizado em `pdr-win-assistente.md`).
- [x] Modularização de `api/_server.ts` em `routes/ services/ agents/ db/ lib/` (zero mudança de comportamento).
- [x] Logger estruturado JSON em `api/lib/logger.ts`.
- [x] Setup vitest + 33 testes iniciais (`parseEscolha`, `parseConfirmacao`, `parseNomeVendedor`, `normalizarNumeroOrcamento`, `formatClienteResumo`, `normalizeTerm`, `extractKeywords`).
- [x] Limpeza de arquivos mortos (`run-sql.ts`, `dbtest.mjs`, `metadata.json`, `_server.ts`).
- [x] Reescrita do `README.md` (não aponta mais para AI Studio/Gemini).

## Fase 1 — Segurança e custo

**Objetivo:** fechar o gap de autenticação e habilitar visibilidade de custo da IA.

Dependências: Fase 0 (modularização).

### 1a — Auth do painel ✅ CONCLUÍDA
- [x] Schema `users` (UUID, email, password_hash bcrypt, role admin/sub, vendedor_id, permissions JSONB, ativo, criado_em, ultimo_login, criado_por).
- [x] Bootstrap de admin inicial via env (`ADMIN_INITIAL_EMAIL` + `ADMIN_INITIAL_PASSWORD`).
- [x] JWT em cookie httpOnly (`win_auth`, 7d, sameSite lax), validação recarregando user do banco a cada request.
- [x] Middleware `requireAuth`, `requireRole`, `requirePermission` aplicado em todas as rotas (webhook fica fora).
- [x] Routes `POST /api/auth/{login,logout}` + `GET /api/auth/me`.
- [x] Routes `users` (CRUD admin-only) + `GET /api/permissions` para a UI.
- [x] Isolamento por vendedor em `orcamentos`, `vendedores`, `sessoes`, `mensagens` quando `users.role='sub'` e `users.vendedor_id IS NOT NULL`.
- [x] Frontend: `AuthContext`, `LoginScreen`, patch global de `fetch` (`credentials: 'include'` + handling de 401), sidebar filtrada por permissão, logout no header.
- [x] Documentação atualizada (CLAUDE, SCHEMA, ARCHITECTURE, DECISIONS).

### 1b — Gestão de sub-logins no painel
- Tela "Usuários" (só admin).
- Admin cria sub-logins, atribui permissões granulares (checkboxes por tab/feature), opcionalmente vincula a um vendedor existente.
- Admin pode revogar, redefinir senha, ativar/desativar.
- Backend já está pronto (Fase 1a) — só a UI.

### 1c — Tracking de custo de IA
- Tabela `ai_usage`: `id`, `mensagem_id` (FK), `model`, `prompt_tokens`, `completion_tokens`, `cost_usd`, `created_at`.
- Wrapper na chamada OpenAI registra usage de cada call (extrator + final).
- Habilita card "Custo do mês" no dashboard da Fase 2.

## Fase 2 — Dashboard BI

**Objetivo:** todas as visões executivas (`Grupo 1` do escopo aprovado).

Dependências: Fase 1 (`vendedor_id` no usuário pra filtrar; `ai_usage` para o card de custo).

Tela nova: **Dashboard** (rota raiz `/` ou aba "Visão geral").

Entregáveis (cards e visualizações):
- **1.1** KPIs do mês: faturamento (Σ total de orçamentos com status=`venda`), ticket médio, conversão (`venda` / `aberto+venda+cancelado`), nº de orçamentos.
- **1.2** Ranking de vendedores: tabela ordenável por faturamento, ticket médio, conversão, tempo médio de fechamento.
- **1.3** Top produtos: mais vendidos (Σ qtd em itens de venda), mais cotados sem venda (em orçamentos `cancelado`), encalhados (sem aparição em N dias).
- **1.4** Análise de clientes: top compradores, inativos (>60 dias), curva ABC.
- **1.5** Funil: mensagens → orçamentos → vendas (com taxas de queda).
- **1.6** Custo de IA: card "tokens consumidos" + "custo estimado mês" + breakdown por modelo.

Endpoints novos: `/api/dashboard/*` agregadores (sem N+1).

## Fase 3 — Histórico de cliente + PDF

**Objetivo:** habilitar consulta de histórico do cliente e gerar o PDF nativo seguindo o template do Bling.

Dependências: Fase 2 (não estrita, mas reusa parte das queries).

### 3.1 — Histórico do cliente
- `GET /api/clientes/:id/historico` → últimos N orçamentos (status, total, data, itens).
- Tela "Detalhe do cliente" no painel com a timeline.

### 3.2 — PDF do orçamento
- Lib: PDFKit ou `@react-pdf/renderer` (decidir no momento).
- Layout em `docs/PDF_ORCAMENTO.md` — espelha o modelo Bling.
- `GET /api/orcamentos/:numero/pdf` retorna `Buffer`.
- Download no painel.
- (Fase 4) Envio automático pelo WhatsApp ao gerar/alterar orçamento.

## Fase 4 — UX no WhatsApp

**Objetivo:** comandos e respostas mais úteis para o vendedor, usando o que foi construído.

Dependências:
- 5.4 depende de 3.1 (histórico do cliente).
- 5.1 depende de 3.2 (PDF gerado).
- 5.3 depende de 2.x (KPIs do vendedor).
- 5.5 depende de 1.c (ou comparação direta com `products.preco_venda` vs último orçamento aberto).

Entregáveis:
- **5.2 `/ajuda`** — mensagem fixa listando comandos suportados.
- **5.4 Histórico do cliente** — "histórico do João" → últimos N orçamentos com totais.
- **5.1 PDF anexo** — quando o agente gerar/alterar orçamento, envia o texto + o PDF como `documentMessage`.
- **5.3 `/status`** — "snapshot" do vendedor (orçamentos abertos, faturamento mês, conversão).
- **5.5 Alerta de mudança de preço** — antes de fechar o orçamento, comparar preço atual com último que o vendedor cotou no mesmo produto; alertar se mudou.

## Princípios contínuos (durante todas as fases)

- Cada fase termina com **commit limpo + atualização de `CLAUDE.md` e `docs/`** dos itens afetados.
- Novo ADR em `DECISIONS.md` para cada escolha não-trivial.
- `npm run lint` passa antes de cada commit.
- Sem mudança destrutiva sem migration versionada.
- Limpeza incremental — código novo nunca deixa arquivo morto.

## Itens descartados do escopo (registro)

Estes vieram da análise estratégica de maio/2026 mas **não entraram** no roadmap atual. Mantidos aqui pra reconsideração futura:

- 2.1 Comissões automáticas
- 2.2 Tabelas de preço por cliente
- 2.3 Desconto controlado
- 2.4 Limite de crédito
- 2.5 Kits/combos
- 2.6 Campanhas/promoções
- 2.7 Repetir último pedido
- 2.8 Sugestão proativa de reposição
- Grupo 3 (perf/custo): 3.1–3.6, 3.8 (modularização (3.7) está dentro)
- Grupo 4: 4.2 Whitelist de vendedores, 4.3 LGPD
