# WIN DISTRIBUIDORA — Suplementos Esportivos

## Documento de Requisitos de Produto (PRD)

### Sistema de Vendas via WhatsApp com IA

| Campo | Detalhe |
|---|---|
| **Versão** | 3.0 |
| **Data** | Maio de 2026 |
| **Classificação** | Confidencial — uso interno |
| **Responsável** | Win Distribuidora |
| **Substitui** | v2.0 (Maio de 2025) |

---

## 1. Visão Geral

### 1.1 Contexto

A Win Distribuidora atende vendedores internos e representantes externos. O processo de receber listas de pedidos e cotações via WhatsApp gerava volume incompatível com atendimento manual. A v2.0 entregou o agente autônomo de orçamentos por texto, áudio, imagem e planilha. A v3.0 evolui a plataforma para incluir:

- **Gestão completa de orçamentos** com numeração própria (`ORC-NNNNNN`), ciclo de vida `aberto → venda/cancelado`, alteração no-fly via WhatsApp.
- **Base de clientes** integrada (importação Tiny/Bling + cadastros via WhatsApp/painel), com busca fuzzy e vinculação automática aos orçamentos.
- **Inteligência de negócio**: dashboard executivo com KPIs, ranking de vendedores, análises de produtos e clientes, custo da IA.
- **Segurança do painel**: autenticação multi-usuário com permissões granulares e isolamento por vendedor.
- **UX no WhatsApp**: comandos `/ajuda`, `/status`, histórico do cliente, PDF do orçamento como anexo, alerta de mudança de preço.

### 1.2 Objetivo

Operar com **zero intervenção humana** no atendimento de pedidos a partir do canal WhatsApp, mantendo o painel administrativo como ponto de gestão estratégica, controle de catálogo, clientes e visibilidade de resultados.

### 1.3 Fora do escopo (v3.0)

- Integração automática (API) com o Winthor — importação de estoque permanece manual via Excel.
- Módulo financeiro / emissão de nota fiscal.
- Notificações para equipe humana intermediária.
- Comissionamento, tabelas de preço por cliente, descontos, kits, promoções, validação de crédito (descartados nesta versão; ver `docs/ROADMAP.md` "Itens descartados").

---

## 2. Stakeholders

| Perfil | Função | Interação |
|---|---|---|
| **Administrador** | Gestor da WIN | Painel: importação de estoque, gestão de clientes/produtos/configurações, criação de sub-logins, visão BI completa |
| **Sub-administrador / vendedor com login** | Operacional | Painel com permissões granulares — vendedor enxerga apenas o que é seu |
| **Agente de IA** | Atendente virtual no WhatsApp | Processa mensagens, mantém histórico por sessão, busca produtos, gera/altera orçamentos, cadastra clientes |
| **Vendedor (WhatsApp)** | Representante interno/externo | Envia pedidos por texto/áudio/imagem/planilha e recebe o orçamento direto na conversa |

> **Não existe** perfil de "Atendimento Humano" no fluxo de WhatsApp. O agente de IA é o único responsável.

---

## 3. Arquitetura Técnica

### 3.1 Stack

| Camada | Tecnologia | Papel |
|---|---|---|
| Gateway WhatsApp | Evolution API | Recebe/envia mensagens, mídia em base64 inline |
| Banco | Supabase Postgres + extensões `pg_trgm`, `unaccent`, `uuid-ossp` | Estoque, clientes, histórico, busca fuzzy |
| Backend | Node 22 + Express + TypeScript | Webhooks, sessões, busca, chamadas de IA, REST do painel |
| Hospedagem | Vercel (serverless) | Build estático do painel + functions da API |
| IA — Classificação | OpenAI gpt-4.1 (`response_format: json_object`, `temperature: 0`) | Extrai intent + termos de busca + referências |
| IA — Resposta + Tools | OpenAI gpt-4.1 com function calling | Conversa, confirmação de itens, chamada de `finalizar_orcamento`/`alterar_orcamento`/`cadastrar_cliente`/`editar_cliente` |
| IA — Visão | OpenAI gpt-4o | Lê fotos de listas de pedidos |
| IA — Áudio | OpenAI whisper-1 | Transcrição em PT-BR |
| Painel | React 19 + Vite + Tailwind 4 | UI administrativa |

Detalhes em `docs/ARCHITECTURE.md`.

### 3.2 Pipeline da mensagem

Documentado em `docs/ARCHITECTURE.md` (16 etapas) e `docs/FLOWS.md` (fluxos passo-a-passo com edge cases). Resumo:

1. Webhook do Evolution recebe `messages.upsert`.
2. Decodifica mídia (Whisper, GPT-4o vision, xlsx, CSV) → texto.
3. Carrega/cria vendedor + sessão (com timeout e detecção de "novo pedido").
4. **Onboarding** bloqueante se vendedor sem nome.
5. **Ações pendentes** (confirmações de venda/cancel, seleção de cliente) consumidas antes de chamar IA.
6. Extrator (gpt-4.1) classifica intent e termos.
7. Roteamento determinístico para intents administrativas (listar/buscar/fechar/cancelar).
8. Para pedido/alteração: busca multi-estratégia + LLM final com tools.
9. Persistência da resposta + envio ao Evolution + ack.

---

## 4. Gestão de Sessões e Histórico

### 4.1 Isolamento por vendedor

Cada conversa é isolada por `vendedores.numero_whatsapp`. O backend garante que histórico nunca vaze entre números.

### 4.2 Ciclo de sessão

Apenas **uma sessão ativa** por vendedor. Critérios de transição:

- **Timeout**: `system_config.session_timeout_hours` (default 2h) sem mensagens → encerra e cria nova na próxima.
- **`new_session: true`** vindo do extrator (vendedor disse "novo pedido", "outro cliente"): encerra e cria nova, zera o histórico no LLM.
- **Geração de orçamento**: ao executar `finalizar_orcamento` ou `alterar_orcamento`, sessão vai para `orcamento_gerado` com `encerrada_em` setado.

### 4.3 Tabelas

Documentação completa em `docs/SCHEMA.md`. Visão das principais:

- `products` — catálogo (SERIAL, descrição, preço, marca, embalagem, categoria, código de barras, ativo).
- `vendedores` — 1 por número WhatsApp (UUID, nome, ativo).
- `sessoes` — UUID, FK vendedor, status, `acao_pendente` JSONB (state machine).
- `mensagens` — log completo, papel (user/assistant), tipo_midia.
- `orcamentos` — `ORC-NNNNNN` único, status (aberto/venda/cancelado), itens JSONB, FK cliente.
- `clientes` — base importada do Tiny/Bling com busca fuzzy.
- `system_config` — singleton (core_prompt, session_timeout_hours).

---

## 5. Funcionalidades — v3.0

### 5.1 Agente WhatsApp (já em produção, mantido)

- **Multi-formato**: texto, áudio (Whisper), imagem (GPT-4o), `.xlsx`/`.csv` via documento.
- **Onboarding**: pergunta e armazena o nome do vendedor antes de aceitar qualquer pedido.
- **Histórico contextual**: histórico completo da sessão ativa enviado ao LLM em toda mensagem.
- **Busca fuzzy** (`pg_trgm` + `unaccent` + keyword AND): tolera typo, substring, multi-palavra, gramatura/unidade.
- **Listagem de variações**: quando vendedor pergunta "quais sabores do X?", lista TODAS — sem omissão, ordem determinística.
- **Geração de orçamento autônoma** via tool call `finalizar_orcamento` — `ORC-NNNNNN` sequencial.
- **Alteração** via `alterar_orcamento` em orçamentos em aberto.
- **Cadastro/edição de cliente** via WhatsApp (`cadastrar_cliente`, `editar_cliente`) com seleção quando há ambiguidade.
- **Intents administrativas**: listar abertos, buscar por cliente, fechar como venda, cancelar orçamento — todas com confirmação sim/não para mudanças de estado.

### 5.2 Painel administrativo (atual — sem auth)

> **Gap conhecido — fechado na Fase 1 do roadmap**: hoje qualquer um com a URL acessa o painel.

Tabs disponíveis:
- **Importação** — upload `.xlsx` do Winthor (mapeamento automático de colunas, parser de preço BR).
- **Produtos** — listagem, toggle ativo/inativo.
- **Clientes** — CRUD, busca fuzzy, soft delete.
- **Histórico** — drill-down vendedor → sessão → mensagens.
- **Orçamentos** / **Vendas** — listagem com filtros, drill-down, ações (fechar/cancelar/reabrir).
- **Configurações** — `core_prompt`, `session_timeout_hours`, setup do webhook no Evolution.

### 5.3 Evolução v3.0 (roadmap aprovado)

Detalhe em `docs/ROADMAP.md`. Sumário:

| Fase | Entrega |
|---|---|
| **0** | Fundação: docs, modularização do backend, logger estruturado, testes, limpeza |
| **1** | Autenticação multi-usuário com permissões granulares (admin cria sub-logins, vincula a vendedor, define escopo); tracking de custo da IA |
| **2** | Dashboard BI: faturamento, ranking de vendedores, top produtos, clientes ABC, funil mensagens→orçamento→venda, custo IA |
| **3** | Histórico de compras do cliente (endpoint + visualização) e geração de PDF nativo do orçamento (template em `docs/PDF_ORCAMENTO.md`) |
| **4** | UX WhatsApp: `/ajuda`, `/status`, "histórico do cliente X", PDF anexo no envio, alerta de mudança de preço |

---

## 6. Comportamento do agente

Regras estritas que sustentam o agente (também versionadas em `system_config.core_prompt`, editável pelo admin):

1. O agente tem acesso ao **histórico completo da sessão ativa** e o usa para entender pedidos construídos em múltiplas mensagens.
2. **Confirma os itens** identificados antes de gerar qualquer orçamento.
3. **Gera e envia o orçamento** após a confirmação dos itens + nome do cliente, sem intervenção humana.
4. **Não mistura contextos** entre sessões; quando detecta novo pedido, trata-o isoladamente.
5. **Nunca inventa produtos** — opera só com os itens retornados pela busca.
6. **Formato WhatsApp**: negrito com UM asterisco (`*texto*`), sem tabelas pipe, sem markdown desktop.
7. **Listagem de variações é completa e determinística** — o agente NUNCA filtra, omite ou reordena os itens do grupo.
8. **Cliente é obrigatório no orçamento** — o agente pergunta o nome do cliente antes de finalizar. Não inventa.

---

## 7. Requisitos não-funcionais

| Requisito | Especificação |
|---|---|
| **Tempo de resposta** | Texto < 5s p95; planilha grande < 20s p95. |
| **Segurança** | Credenciais em `.env`, nunca em código. Painel protegido por auth (Fase 1). |
| **Isolamento multi-vendedor** | Garantia de que o histórico de um vendedor jamais vaza para outro. |
| **Consistência de sessão** | Sessões encerradas não reabrem; nova interação cria nova sessão. |
| **Determinismo de busca** | Mesma query devolve mesmos top-N na mesma ordem (`ORDER BY sml DESC, id ASC`). |
| **Idempotência de webhook** | Pendente (Fase 1+) — hoje re-entrega gera processamento duplicado. |
| **Observabilidade** | Logs estruturados JSON (Fase 0), tracking de tokens/custo OpenAI (Fase 1). |
| **Cobertura de testes** | Setup vitest na Fase 0; cobertura mínima de `searchProducts`, parsers de intent, normalização de número. |

---

## 8. Critérios de aceite (mantidos da v2.0 + adições v3.0)

**Mantidos:**
- Busca devolve os 5+ itens mais próximos de query digitada com typo em < 1s.
- Orçamento autônomo gerado corretamente em 100% dos casos confirmados.
- Sessões isoladas por janela temporal (acima do timeout configurado).
- Isolamento entre números de vendedor.
- Planilha com pedidos extrai 95%+ dos itens.
- Pedido construído em ≥5 mensagens consolida em orçamento correto.

**Novos (v3.0):**
- **Numeração ORC-NNNNNN** única, sem colisão, ordem cronológica.
- **Status do orçamento** transita corretamente (aberto → venda OU aberto → cancelado), com possibilidade de reabrir.
- **Alteração** preserva o número original e atualiza `atualizado_em`.
- **Cliente é vinculado** ao orçamento (`cliente_id` FK), com snapshot do nome em `cliente_nome`.
- **Busca de cliente** com 1 match forte (CPF/CNPJ/externo_id/telefone/fuzzy≥0.7) executa sem perguntar; múltiplos → lista numerada; nenhum → oferece cadastrar.
- **Edição de cliente via WhatsApp** atualiza somente os campos solicitados, preservando os demais.
- **Painel autenticado** (Fase 1): admin vê tudo; vendedor com login vê apenas seus dados.
- **Dashboard** (Fase 2): KPIs computados a partir de queries agregadas sem N+1.
- **PDF do orçamento** (Fase 3): segue layout do `docs/PDF_ORCAMENTO.md`, totais batem com o registro em banco.

---

## 9. Documentação complementar

| Documento | Conteúdo |
|---|---|
| `CLAUDE.md` | Guia operacional para sessões de IA (Claude Code) — comandos, convenções, onde mexer |
| `docs/ARCHITECTURE.md` | Arquitetura lógica e pipeline da mensagem |
| `docs/SCHEMA.md` | Esquema completo do banco (tabelas, índices, shapes JSONB) |
| `docs/FLOWS.md` | Fluxos passo-a-passo, edge cases, state machine |
| `docs/DECISIONS.md` | ADRs — decisões arquiteturais com contexto e consequências |
| `docs/PDF_ORCAMENTO.md` | Template do PDF de orçamento |
| `docs/ROADMAP.md` | Fases 0–4 detalhadas |

---

*WIN Distribuidora · PRD v3.0 · Maio 2026*
