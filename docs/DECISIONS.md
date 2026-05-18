# Decisões Arquiteturais (ADR)

Registro das escolhas técnicas com **contexto, razão e consequências**. Adicione um novo ADR ao fim quando tomar uma decisão não-trivial que afete a arquitetura.

---

## ADR-001 — Pipeline em duas etapas (extrator + final)

**Status:** aceito

**Contexto:** O agente precisa entender se a mensagem é um pedido, listagem, fechamento, ou outra ação — e só então buscar produtos no banco e responder. Misturar tudo numa única chamada LLM resultava em respostas inconsistentes e alucinação de produtos.

**Decisão:** Dividir em dois passes:
1. **Extrator** (`gpt-4.1`, `temperature: 0`, `response_format: json_object`): devolve `{intent, new_session, ref_numero, cliente_busca, terms[]}` — *classificação determinística*.
2. **Final response** (`gpt-4.1`, com tool calling): só para intents `pedido` ou `alterar_orcamento`. Recebe o estoque já filtrado e gera a conversa + tool call.

**Consequências:**
- Custo dobrado por mensagem em texto. Mitigado em parte porque intents administrativas (50%+ do tráfego) pulam o final response.
- Determinismo da classificação destravou roteamento limpo no backend (`if intent === 'listar_abertos' …`).
- Manter os dois prompts em sync é trabalho — vão pra `api/agents/prompts.ts` na modularização.

**Evolução planejada:** trocar o extrator por `gpt-4o-mini` ou similar (~10x mais barato) e medir queda de qualidade. Não nesta fase.

---

## ADR-002 — Busca com `pg_trgm` + `unaccent` + keyword AND

**Status:** aceito

**Contexto:** Vendedores digitam errado, escrevem em parte ("creatina dux 300g"), e perguntam variações ("quais sabores do tasty whey"). Trigram só não cobre casos multi-palavra; ILIKE substring não tolera typo; vector search puro é caro e overkill para um catálogo pequeno (~10k produtos).

**Decisão:** Três estratégias compostas em `searchProducts`:
1. **Trigram similarity** (`similarity(unaccent(lower(desc)), unaccent(lower(termo)))`) com threshold 0.08.
2. **ILIKE substring** do termo inteiro (bônus 0.5).
3. **Keyword AND** com normalização (`"300g"` → `"300 g"`), strong words (≥3 chars, não stop word, exigidas AND) + weak words (números/unidades, bônus 0.1 cada).

A Strategy 3 só sobrescreve as anteriores se trouxer `sml` maior, evitando piorar matches já bons.

**Consequências:**
- Cobre typo, substring, multi-palavra e gramatura/unidade.
- `MAX_PER_TERM = 30` é alto deliberadamente — listagem de variações precisa ser completa.
- Determinismo: `ORDER BY sml DESC, id ASC` garante mesma ordem para mesma query (sem `id ASC` o Postgres pode reordenar empates).

---

## ADR-003 — JSONB para `itens` do orçamento e `acao_pendente`

**Status:** aceito

**Contexto:** Itens do orçamento são um snapshot do que foi cobrado: descrição, marca, qtd, preço, subtotal. Não precisam ser indexados (consulta é sempre via orçamento). `acao_pendente` é um estado transitório de máquina de estados; campos variam por tipo.

**Decisão:** JSONB nas duas colunas.

**Consequências:**
- Schema flexível pra evoluir o shape sem migration.
- Sem queries do tipo "soma de quantidade de produto X em todos os orçamentos" eficientes — mas é raro o suficiente; quando precisar, pode usar `jsonb_array_elements` ou tabela `orcamento_itens` derivada.
- Lê e escreve via `JSON.stringify(...)` no backend; cast `::jsonb` no SQL.

---

## ADR-004 — Sequência humana de orçamentos (`ORC-NNNNNN`)

**Status:** aceito

**Contexto:** UUID como identificador externo é hostil (`b3f5e2c1-…`). Vendedores precisam ditar números de orçamento por voz pelo WhatsApp.

**Decisão:** Sequência separada `orcamento_numero_seq` (START 1, INCREMENT 1). Formato `ORC-` + zero-pad 6 dígitos. Coluna `numero TEXT UNIQUE`, separada do `id UUID`.

**Consequências:**
- Cobre 999.999 orçamentos antes de precisar de 7 dígitos.
- `normalizarNumeroOrcamento("123")` aceita "123" ou "ORC-123" ou "orc 45" e converte pro formato canônico.
- Buracos na sequência se o sistema crashar no meio de uma transação — aceito.

---

## ADR-005 — Onboarding bloqueante por nome do vendedor

**Status:** aceito

**Contexto:** Sem o nome do vendedor, todos os orçamentos ficariam órfãos no painel (só com número de WhatsApp). E o agente perderia a oportunidade de personalizar resposta.

**Decisão:** Quando `vendedores.nome IS NULL`, o agente **só** pergunta o nome — não roda extractor, busca ou responde a pedido. `parseNomeVendedor` valida estritamente: rejeita números, frases longas, palavras com dígito.

**Consequências:**
- Primeira mensagem de qualquer número novo é "qual seu nome?". Atrito mínimo.
- Vendedor pode burlar respondendo `"Quero whey gold"` — `parseNomeVendedor` rejeita (tem dígito? não, mas a heurística usa regex de só letras+espaços, ≤5 palavras). Em último caso, o admin pode preencher o nome via painel.

---

## ADR-006 — Schema migrations no boot (idempotentes)

**Status:** aceito — **em revisão para Fase 1**

**Contexto:** Cedo no projeto, manter migrations versionadas seria overhead. Toda DDL é `CREATE IF NOT EXISTS` + `ALTER ADD COLUMN IF NOT EXISTS`.

**Decisão:** `initDB()` roda lazy no primeiro request (não no startup, pra não bloquear cold start na Vercel). É chamado por `ensureDB()` que cacheia a Promise.

**Consequências:**
- Deploy zero-touch — basta subir código.
- Risco: a ordem das instruções importa, e mudanças destrutivas (drop, rename, alterar constraint) precisam DO blocks com `information_schema` (já fazemos para `orcamentos_status_check`).
- A medida que o schema crescer, isso vai ficar frágil.

**Evolução planejada:** introduzir `api/db/migrations/NNN_descricao.sql` na primeira mudança destrutiva real (auth na Fase 1 já é candidato).

---

## ADR-007 — `webhookBase64: true` na configuração do Evolution

**Status:** aceito

**Contexto:** Evolution pode mandar mídia por URL (precisa baixar) ou inline base64. Cada extra round-trip aumenta a latência percebida e adiciona ponto de falha.

**Decisão:** Habilitar `webhookBase64: true` na config do webhook. Áudios, imagens e documentos chegam como base64 em `msg.base64`.

**Consequências:**
- Payload do webhook grande (centenas de KB para áudio). OK pra Vercel (limit 4.5MB request body).
- Whisper / GPT-4o vision / xlsx recebem `Buffer.from(base64, 'base64')` direto.
- Se um dia mudarmos para um gateway diferente, reimplementar a lógica de download.

---

## ADR-008 — Ack imediato + processamento síncrono no webhook

**Status:** aceito — **rever para Fase 1**

**Contexto:** Evolution tem timeout no webhook. Processamento de planilha grande ou áudio longo pode estourar.

**Decisão:** `ack()` (200) é chamado no `finally`. **Mas** o processamento continua síncrono dentro do handler — só ack é movido para o final. Em prática, o processamento médio é sub-2s.

**Consequências:**
- Em caso de mensagens grandes, ainda podemos estourar timeout do Evolution (e a mensagem é re-enviada).
- Não temos idempotência por `message_id` — re-entrega gera processamento duplicado. Isso é dívida.

**Evolução planejada:** mover o processamento para queue (Vercel Queues) ou Workflow (DevKit) na Fase 1+. Hoje a dor é baixa.

---

## ADR-009 — `DELETE FROM products` no upload-stock

**Status:** aceito — **fragilidade conhecida**

**Contexto:** A planilha do Winthor é a fonte de verdade. Item retirado de lá deveria sumir do catálogo.

**Decisão:** No upload, `DELETE FROM products` + INSERT em chunks de 500.

**Consequências:**
- **Customizações manuais (ativo/inativo) são perdidas a cada import.** Hoje vivemos com isso.
- Migration future: usar `MERGE` ou tabela staging + diff para preservar `ativo` por código de barras / código.

---

---

## ADR-010 — JWT em cookie httpOnly para auth do painel

**Status:** aceito

**Contexto:** O painel precisa de autenticação multi-usuário com permissões granulares. Opções avaliadas: (a) JWT em localStorage, (b) JWT em cookie httpOnly, (c) Clerk/Auth0. Localstorage expõe o token a XSS. Provedor externo adiciona dependência e custo. O painel é de uso interno (poucos usuários, controle total).

**Decisão:** JWT assinado com HS256 + secret de 48 bytes em `JWT_SECRET`, guardado em cookie httpOnly `win_auth` (`sameSite: lax`, `secure: true` em prod, 7d de expiração). Validação em `api/middleware/auth.ts` recarrega o `user` do banco a cada request para garantir frescor (permissões/ativo podem ter mudado depois do login).

**Consequências:**
- Frontend não tem acesso ao token (proteção contra XSS).
- Pequeno overhead por request (uma query a `users`). Aceitável dado o volume.
- 401 globalmente captado via patch de `fetch` que dispara o evento `auth-expired` (ver `src/lib/install-fetch.ts`).
- Em deploy multi-domínio, vai precisar configurar `sameSite: none + secure`. Hoje frontend e API estão no mesmo domínio (`winassistente.vercel.app`).

---

## ADR-011 — Permissões granulares + isolamento por vendedor

**Status:** aceito

**Contexto:** Vendedores logados não devem ver orçamentos/clientes/vendas de outros vendedores. Admin precisa ver tudo. Operacional sem vínculo a vendedor (ex: gerente) pode precisar ver tudo mas só editar parte.

**Decisão:**
- Roles binários: `admin` (todas as permissões implícitas) ou `sub` (granular via `permissions` array em `users.permissions` JSONB).
- Vinculação opcional `users.vendedor_id → vendedores.id`. Quando preenchido E role=`sub`, **força isolamento** em todas as queries de `orcamentos`/`vendedores`/`sessoes`/`mensagens`.
- Filtro de isolamento é aplicado **depois** dos filtros do client (não pode ser bypassado por query param).

**Consequências:**
- Sub-login sem `vendedor_id` é um "operacional sem isolamento" — usa as permissões para acesso, mas vê o universo todo.
- Não há "owner" em produtos/clientes/config — isolamento é só por vendedor em entidades que têm `vendedor_id`.
- Lista canônica de permissões em `api/lib/auth.ts:PERMISSIONS`. Espelhada em `src/lib/permissions.ts`.

---

## ADR-012 — Dashboard agregando direto do Postgres (sem materialized views)

**Status:** aceito

**Contexto:** A Fase 2 entrega 6 grupos de cards (KPIs, ranking, top produtos, clientes, funil, custo IA) com filtro de período. Volume hoje é baixo (centenas de orçamentos/mês), índices já existem para os filtros principais (`idx_orcamentos_vendedor_status`, `idx_ai_usage_*`). Materialized views ou snapshots agendados melhorariam tempo de resposta mas trariam complexidade: lag de dados, jobs de refresh, novo schema a manter.

**Decisão:**
- Cada endpoint do dashboard executa queries diretas com `GROUP BY` / `FILTER (WHERE …)` / `COUNT(*) FILTER (…)` sobre as tabelas operacionais.
- Top produtos usa `LATERAL jsonb_array_elements(orcamentos.itens)` — não há FK pra `products` dentro do JSON, agrupa por `(descricao, marca)` (snapshot do item).
- Cálculos compostos derivados em JS no service (ticket médio, conversão, curva ABC). ABC é puro — testado em `tests/dashboard.test.ts`.
- Período via helper `api/lib/period.ts` (`resolveRange`): aceita `?de=&ate=` (YYYY-MM-DD, inclusivos), default mês atual, devolve `ate` right-open pra comparações `< $2`.
- Isolamento por vendedor mantém o mesmo padrão dos demais routers: sub-login com `vendedor_id` → filtro forçado no SQL, parâmetro adicionado depois dos filtros do client.

**Consequências:**
- Latência aceitável enquanto volume não explodir. Quando passar disso, primeiro candidato a virar MV é a curva ABC (varre todo o histórico de vendas a cada request).
- Endpoints separados → fácil cachear individualmente no futuro (Vercel `revalidate` ou KV) sem ter que invalidar tudo.
- Custos de IA aparecem por vendedor no payload mas a UI atual mostra só agregados (modelo / purpose). Tem espaço pra crescer sem nova rota.

**Evolução planejada:** caching com tag-based invalidation se latência incomodar (`revalidateTag('dashboard')` no momento que orçamento muda status). Mover encalhados/inativos pra MV se o `jsonb_array_elements` virar gargalo no plan.

---

## Como adicionar um novo ADR

1. Próximo número sequencial (ADR-010, ADR-011, …).
2. Título curto descrevendo a decisão.
3. **Status** (proposto / aceito / superado por ADR-NNN).
4. **Contexto** — o problema que motivou a decisão.
5. **Decisão** — o que foi feito.
6. **Consequências** — trade-offs e o que precisa cuidar daqui pra frente.
7. **(Opcional)** Evolução planejada.
