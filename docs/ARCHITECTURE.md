# Arquitetura — WIN Distribuidora

## Visão de 10.000 metros

```
┌────────────────┐   WhatsApp   ┌─────────────────┐
│   Vendedor     │ ───────────► │  Evolution API  │
│   (WhatsApp)   │ ◄─────────── │  (gateway)      │
└────────────────┘              └────────┬────────┘
                                         │ webhook (messages.upsert)
                                         ▼
                          ┌────────────────────────────────┐
                          │  Backend Node/Express (Vercel) │
                          │                                │
                          │   /api/webhook/evolution       │
                          │   /api/orcamentos              │
                          │   /api/clientes                │
                          │   /api/products                │
                          │   /api/vendedores              │
                          │   /api/config                  │
                          │   /api/upload-stock            │
                          └─────┬──────────────────┬───────┘
                                │                  │
                  ┌─────────────▼──┐    ┌──────────▼─────────┐
                  │  OpenAI API    │    │  Supabase Postgres │
                  │  · gpt-4.1     │    │  · products        │
                  │  · gpt-4o      │    │  · vendedores      │
                  │  · whisper-1   │    │  · sessoes         │
                  └────────────────┘    │  · mensagens       │
                                        │  · orcamentos      │
                                        │  · clientes        │
                                        │  · system_config   │
                                        └────────────────────┘

                          ┌────────────────────────────────┐
                          │   Painel Admin (React + Vite)  │
                          │                                │
                          │   Importação · Produtos ·      │
                          │   Clientes · Histórico ·       │
                          │   Orçamentos · Vendas ·        │
                          │   Configurações                │
                          └────────────────┬───────────────┘
                                           │ fetch /api/*
                                           ▼
                            (mesmo backend Express acima)
```

## Componentes lógicos do backend

> Estrutura **alvo** (pós Fase 0). Pre-modularização, tudo está em `api/_server.ts`. A modularização não muda comportamento — só dispõe o código.

```
api/
├── index.ts              Re-export do app para a Vercel serverless
├── server.ts             Bootstrap: dotenv, express, cors, cookieParser, mount routes
│
├── db/
│   ├── pool.ts           Pool pg singleton (DATABASE_URL, SSL, max=5)
│   └── migrations.ts     initDB() / ensureDB() / bootstrapAdmin() — DDL idempotente
│
├── middleware/
│   └── auth.ts           requireAuth, requireRole, requirePermission, AuthRequest
│
├── routes/
│   ├── auth.ts           POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
│   ├── users.ts          CRUD admin-only de users (login do painel)
│   ├── webhook.ts        POST /api/webhook/evolution (sem auth — Evolution chama)
│   ├── products.ts       GET/PUT /api/products[/:id/toggle], POST /api/upload-stock
│   ├── clientes.ts       CRUD /api/clientes
│   ├── orcamentos.ts     GET/PATCH /api/orcamentos[/:numero/[fechar|cancelar|reabrir]]
│   ├── vendedores.ts     GET/PUT /api/vendedores + sessions/mensagens
│   ├── config.ts         GET/PUT /api/config
│   └── setup.ts          POST /api/setup-webhook (admin only)
│
├── services/
│   ├── search.ts         searchProducts() + searchClientes() + normalize/keyword extract
│   ├── orcamentos.ts     gravarOrcamento(), resolverClienteEGravar(), formatarTextoOrcamento(), normalizarNumeroOrcamento()
│   ├── whatsapp.ts       sendWhatsAppMessage()
│   ├── intents.ts        parseNomeVendedor, parseConfirmacao, parseEscolha, formatListaClientes, formatClienteResumo
│   └── media.ts          Transcrição (Whisper), visão (gpt-4o), planilhas (xlsx)
│
├── agents/
│   ├── prompts.ts        EXTRACT_INTENT_PROMPT + buildFinalPrompt + buildAlteracaoBlock + buildStockContext
│   └── tools.ts          Definições das functions (finalizar/alterar/cadastrar/editar)
│
└── lib/
    ├── logger.ts         Logger estruturado JSON
    ├── openai.ts         OpenAI client singleton
    └── auth.ts           bcrypt hash/verify + JWT sign/verify + PERMISSIONS + hasPermission
```

## Pipeline da mensagem no webhook

```
POST /api/webhook/evolution
        │
        ▼
1. validar event.type == 'messages.upsert' e !key.fromMe
2. extrair phoneJid (preferir remoteJidAlt)
3. ignorar grupos (@g.us)
        │
        ▼
4. tipo de mídia?
   ├─ audioMessage  → Whisper transcribe
   ├─ imageMessage  → GPT-4o vision
   ├─ documentMessage (xlsx/csv) → xlsx parse
   └─ texto         → direto
        │
        ▼
5. ensureDB()
6. carregar/criar vendedor (insert ON CONFLICT)
7. carregar sessão ativa OU criar nova (se timeout estourou)
        │
        ▼
8. ONBOARDING? (vendedor sem nome cadastrado)
   ├─ não perguntei ainda → pergunta o nome → return
   └─ já perguntei         → parseNomeVendedor → salva ou repete pergunta → return
        │
        ▼
9. ACAO_PENDENTE?
   ├─ selecionar_cliente          → parseEscolha + gravarOrcamento → return
   ├─ selecionar_cliente_edicao   → parseEscolha + UPDATE clientes → return
   └─ fechar_venda / cancelar     → parseConfirmacao + UPDATE → return
        │
        ▼
10. EXTRACT INTENT (gpt-4.1, json_object, temp=0)
    → { intent, new_session, ref_numero, cliente_busca, terms[] }
        │
        ▼
11. ROTEAMENTO POR INTENT:
    ├─ listar_abertos       → query + reply determinístico → return
    ├─ buscar_por_cliente   → query + reply determinístico → return
    ├─ fechar_venda         → set acao_pendente=fechar_venda → return
    ├─ cancelar_orcamento   → set acao_pendente=cancelar → return
    ├─ alterar_orcamento    → carrega orçamento + entra em "modo alteração"
    └─ pedido               → segue fluxo normal
        │
        ▼
12. SEARCH PRODUCTS (groupedResults por termo)
        │
        ▼
13. FINAL LLM (gpt-4.1 com tools)
    system: finalPrompt (core_prompt + stockContext + alteracaoBlock + regras WhatsApp)
    user:   histórico da sessão + mensagem nova
    tools:  finalizar_orcamento | alterar_orcamento | cadastrar_cliente | editar_cliente
        │
        ▼
14. tool_call?
    ├─ finalizar_orcamento   → resolverClienteEGravar → cria orcamento, fecha sessão
    ├─ alterar_orcamento     → resolverClienteEGravar (UPDATE)
    ├─ cadastrar_cliente     → INSERT clientes + reply
    └─ editar_cliente        → busca cliente + (UPDATE direto OU pendente)
   OU
    ├─ texto livre → envia como resposta ao WhatsApp
        │
        ▼
15. registra mensagem do assistant em `mensagens`
16. ack() (200 OK pro Evolution)
```

## Frontend (painel admin)

Single-page React 19 + Vite + Tailwind 4. **Não tem autenticação** hoje (gap a ser fechado na Fase 1). Todas as tabs estão em `src/App.tsx`:

- `ImportTab` — upload de planilha do Winthor (.xlsx → base64 → POST `/api/upload-stock`).
- `ProductsTab` — listagem + toggle ativo/inativo.
- `ClientesTab` — CRUD + busca fuzzy + ativar/desativar.
- `HistoryTab` — drill-down: vendedores → sessões → mensagens.
- `OrcamentosTab` (mode='orcamentos'|'vendas') — listagem com filtros, drill-down, ações (fechar/cancelar/reabrir).
- `SettingsTab` — edita `core_prompt`, `session_timeout_hours`; aciona setup do webhook no Evolution.

## Decisões macro

Ver `docs/DECISIONS.md` para o histórico completo. As mais importantes:

- **Por que dois passes de LLM?** Separar classificação (determinística) de geração (criativa) reduz alucinação e custo.
- **Por que `pg_trgm` + ILIKE + keyword AND?** Cada estratégia cobre um caso de falha da outra. Trigram pega typos, ILIKE pega substring exata, keyword AND pega multi-palavra com peso (nome + número/unidade).
- **Por que JSONB em `acao_pendente` e `orcamentos.itens`?** Snapshot de dados que não precisam ser indexados; flexibilidade pra evoluir o shape sem migration.
- **Por que sequência manual de orçamento (`orcamento_numero_seq`)?** Número humano-legível (ORC-000123), independente do `id` UUID. Padding com 6 dígitos cobre ~1M orçamentos.
- **Por que ack imediato no webhook?** Evolution tem timeout curto; processar e responder pelo Evolution outro endpoint mantém o webhook idempotente do ponto de vista do gateway.
