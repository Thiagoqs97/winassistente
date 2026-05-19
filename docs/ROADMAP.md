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

### 1b — Gestão de sub-logins no painel ✅ CONCLUÍDA
- [x] Tela "Usuários" no painel (sidebar visível só para admin).
- [x] Admin cria sub-logins com nome, e-mail, senha (mín. 8 chars), role (`admin`/`sub`), vendedor vinculado opcional e permissões granulares.
- [x] Permissões agrupadas por área (Produtos, Clientes, Orçamentos e vendas, Vendedores e histórico, Sistema) com toggle "selecionar tudo" por grupo.
- [x] Edição: alterar nome, role, vendedor, permissões, redefinir senha, ativar/desativar.
- [x] Proteções: usuário não pode alterar o próprio role nem desativar a si mesmo; e-mail é imutável após criação.

### 1c — Tracking de custo de IA ✅ CONCLUÍDA
- [x] Tabela `ai_usage` (`vendedor_id`, `sessao_id`, `mensagem_id`, `model`, `purpose`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_usd`, `created_at`) + índices por data, vendedor e modelo.
- [x] Wrapper `chatComplete` em `api/lib/ai.ts` — pricing por 1M tokens, computa `cost_usd` no momento da call (snapshot), insere assíncrono (não bloqueia resposta ao vendedor).
- [x] Aplicado em todas as chat completions: extractor + final (`gpt-4.1`) no webhook e vision (`gpt-4o`) no parser de imagem. Whisper fica fora — a API não retorna `usage`.
- [x] Habilita o card "Custo do mês" do dashboard (Fase 2) e relatórios por vendedor/modelo.

## Fase 2 — Dashboard BI ✅ CONCLUÍDA

**Objetivo:** todas as visões executivas (`Grupo 1` do escopo aprovado).

Dependências: Fase 1 (`vendedor_id` no usuário pra filtrar; `ai_usage` para o card de custo).

Tela nova: **Dashboard** — primeira aba da sidebar, permissão `dashboard.view`.

Entregáveis (cards e visualizações):
- [x] **1.1** KPIs do mês: faturamento (Σ total de orçamentos com status=`venda`), ticket médio, conversão (`venda` / total), nº de orçamentos com breakdown por status (aberto/cancelado).
- [x] **1.2** Ranking de vendedores: tabela com faturamento, vendas/total, ticket médio, conversão, tempo médio de fechamento.
- [x] **1.3** Top produtos: mais vendidos (Σ qtd em itens de venda), mais cotados sem venda (status='cancelado'), encalhados (sem aparição em 90 dias).
- [x] **1.4** Análise de clientes: top compradores, inativos (>60 dias, sinal absoluto), curva ABC 80/15/5.
- [x] **1.5** Funil: mensagens → orçamentos → vendas + taxas de queda Msg→Orç e Orç→Venda.
- [x] **1.6** Custo de IA: total tokens/USD/calls + breakdown por modelo e por purpose (e por vendedor no endpoint, omitido na UI atual).

Endpoints `/api/dashboard/{kpis,ranking-vendedores,top-produtos,clientes,funil,custo-ia}` em `api/routes/dashboard.ts` + agregadores em `api/services/dashboard.ts`. Período via `?de=&ate=` (default mês atual) resolvido em `api/lib/period.ts`. Isolamento por vendedor consistente com orçamentos. Testes em `tests/dashboard.test.ts` cobrem o helper de período e a montagem da curva ABC.

## Fase 3 — Histórico de cliente + PDF ✅ CONCLUÍDA

**Objetivo:** habilitar consulta de histórico do cliente e gerar o PDF nativo seguindo o template do Bling.

Dependências: Fase 2 (não estrita, mas reusa parte das queries).

### 3.1 — Histórico do cliente ✅
- [x] `GET /api/clientes/:id/historico?limit=N` → últimos N orçamentos (id, número, status, total, datas, qtd_itens, vendedor) + agregados (total_vendas, total_abertos, total_cancelados, valor_vendas, ultima_venda, ultimo_orcamento). Respeita isolamento por vendedor.
- [x] Modal "Histórico do cliente" na aba Clientes (botão por linha), com cards de agregados + tabela cronológica.

### 3.2 — PDF do orçamento ✅
- [x] Lib escolhida: **PDFKit** (ver `docs/DECISIONS.md` — ADR sobre PDF).
- [x] Layout em `docs/PDF_ORCAMENTO.md`, espelhando o modelo Bling. Logo retangular azul com "WIN DISTRIBUIDORA", cabeçalho com dados WIN à direita, bloco Cliente + Número/Data, Vendedor, tabela de itens com colunas (Descrição, Código, Un., Qtd., Valor unit., Valor total), totais (N° de itens, Soma das Qtdes, Total de produtos, Total do pedido), área Observações, rodapé com paginação.
- [x] `GET /api/orcamentos/:numero/pdf` retorna o arquivo. Mesmo isolamento por vendedor das outras rotas de orçamentos.
- [x] Botão "📄 Baixar PDF" no painel (aba Vendas → Detalhe).
- [x] Tests `tests/pdf.test.ts` cobrem geração com cliente, sem cliente e com lista vazia.
- (Fase 4) Envio automático pelo WhatsApp ao gerar/alterar orçamento.

## Fase 4 — UX no WhatsApp ✅ CONCLUÍDA

**Objetivo:** comandos e respostas mais úteis para o vendedor, usando o que foi construído.

Dependências:
- 5.4 depende de 3.1 (histórico do cliente).
- 5.1 depende de 3.2 (PDF gerado).
- 5.3 depende de 2.x (KPIs do vendedor).
- 5.5 depende de 1.c (ou comparação direta com `products.preco_venda` vs último orçamento aberto).

Entregáveis:
- [x] **5.2 `/ajuda`** — pré-handler determinístico em `webhook.ts` (parser `parseComandoSlash` em `intents.ts`). Mensagem fixa listando comandos (orçamento, consultas, cliente). Aceita `/ajuda`, `ajuda`, `help`, `comandos`, `menu`.
- [x] **5.4 Histórico do cliente** — novo intent `historico_cliente` no extractor. Handler busca via `searchClientes`, mostra agregados (vendas, abertos, cancelados, última venda) + últimos 5 orçamentos do cliente com o vendedor. Match único forte → resposta direta; múltiplos → pede refinar.
- [x] **5.1 PDF anexo** — `sendWhatsAppDocument()` em `whatsapp.ts` (endpoint Evolution `/message/sendMedia`). `gravarOrcamento` envia o PDF logo após o texto, tanto em finalização quanto em alteração. Falha de anexo só loga — não bloqueia o fluxo principal.
- [x] **5.3 `/status`** — pré-handler. Mostra snapshot do mês corrente: orçamentos abertos, vendas, cancelados, faturamento, ticket médio, conversão. Reusa `getKpis` do dashboard (Fase 2) com escopo do próprio vendedor.
- [x] **5.5 Alerta de mudança de preço** — `api/services/precos.ts` (`getUltimosPrecosVendedor` + `compararPreco`). Busca último preço cotado pelo MESMO vendedor para a mesma `descricao` (90 dias). Variação ≥ 1% vira marcação `[ATENÇÃO PREÇO SUBIU/CAIU: ...]` embutida no `buildStockContext` do prompt final. Prompt instrui o agente a avisar uma única vez antes de pedir confirmação.

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
