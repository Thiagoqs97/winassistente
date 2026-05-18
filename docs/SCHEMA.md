# Schema do Banco — WIN Distribuidora

Banco: **Supabase Postgres**. Extensões habilitadas: `pg_trgm`, `unaccent`, `uuid-ossp`.

Tudo é criado idempotentemente em `initDB()` (hoje em `api/_server.ts`, futuro `api/db/migrations.ts`). RLS está **desabilitado** em `sessoes` e `mensagens` — o backend usa service role.

## Diagrama de relacionamentos

```
products  (SERIAL)
   └── não referencia ninguém (catálogo)

clientes  (UUID)  ◄──┐
                     │
vendedores (UUID) ◄──┼─── orcamentos
                     │         │
                     │         ├── sessao_id  → sessoes.id   (SET NULL)
                     │         ├── vendedor_id → vendedores.id (SET NULL)
                     │         └── cliente_id  → clientes.id   (SET NULL)
                     │
sessoes  (UUID)
   ├── vendedor_id → vendedores.id  (CASCADE)
   └── ◄─── mensagens
                ├── sessao_id   → sessoes.id     (CASCADE)
                └── vendedor_id → vendedores.id  (CASCADE)

system_config (string PK 'default')  — singleton de configurações globais
orcamento_numero_seq (SEQUENCE)      — gera o número ORC-NNNNNN
```

## Tabelas

### `products`
Catálogo importado do Winthor via planilha .xlsx.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | SERIAL PK | — | |
| `codigo` | VARCHAR(255) UNIQUE | — | Pode ser `auto_N` quando vier sem código |
| `descricao` | TEXT NOT NULL | — | Indexado com `gin_trgm_ops` |
| `preco_venda` | NUMERIC(10,2) | NULL | Parser BR (R$ 1.234,50 → 1234.50) |
| `marca` | VARCHAR(255) | NULL | |
| `embalagem` | VARCHAR(255) | NULL | |
| `categoria` | VARCHAR(255) | NULL | |
| `codigo_barras` | VARCHAR(255) | NULL | GTIN/EAN |
| `ativo` | BOOLEAN | true | Ocultar do agente sem deletar |
| `created_at` | TIMESTAMP | now() | |

Índices:
- `trgm_idx_products_descricao` GIN (descricao gin_trgm_ops)
- `trgm_idx_products_descricao_lower` GIN (lower(descricao) gin_trgm_ops)

### `vendedores`
Representantes de venda — 1 por número WhatsApp.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `numero_whatsapp` | TEXT UNIQUE NOT NULL | — | Sem `@s.whatsapp.net` |
| `nome` | TEXT | NULL | Capturado no onboarding |
| `ativo` | BOOLEAN | true | |
| `criado_em` | TIMESTAMP | now() | |

### `sessoes`
Um ciclo de atendimento. Apenas uma `ativa` por vendedor.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `vendedor_id` | UUID FK → vendedores | — | CASCADE |
| `iniciada_em` | TIMESTAMP | now() | |
| `encerrada_em` | TIMESTAMP | NULL | NULL = ativa |
| `status` | TEXT | 'ativa' | CHECK in (ativa, encerrada, orcamento_gerado) |
| `acao_pendente` | JSONB | NULL | Ver "Shapes de acao_pendente" |

### `mensagens`
Log completo das conversas. Ordenado por `criado_em`.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `sessao_id` | UUID FK → sessoes | — | CASCADE |
| `vendedor_id` | UUID FK → vendedores | — | CASCADE |
| `papel` | TEXT | — | CHECK in (user, assistant) |
| `conteudo` | TEXT NOT NULL | — | |
| `tipo_midia` | TEXT | 'texto' | CHECK in (texto, audio, imagem, pdf, planilha) |
| `criado_em` | TIMESTAMP | now() | |

### `orcamentos`
Documento de orçamento numerado.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `numero` | TEXT UNIQUE NOT NULL | — | Formato `ORC-NNNNNN` |
| `sessao_id` | UUID FK → sessoes | NULL | SET NULL on delete |
| `vendedor_id` | UUID FK → vendedores | NULL | SET NULL |
| `cliente_id` | UUID FK → clientes | NULL | SET NULL |
| `cliente_nome` | TEXT | NULL | Snapshot — preservado mesmo se cliente for editado |
| `itens` | JSONB NOT NULL | — | Array; shape em "Shape de orcamentos.itens" |
| `total` | NUMERIC(10,2) NOT NULL | — | |
| `status` | TEXT | 'aberto' | CHECK in (aberto, venda, cancelado) |
| `criado_em` | TIMESTAMP | now() | |
| `atualizado_em` | TIMESTAMP | NULL | Setado em UPDATEs |

Índices:
- `idx_orcamentos_vendedor` (vendedor_id, criado_em DESC)
- `idx_orcamentos_numero` (numero)
- `idx_orcamentos_cliente` (lower(cliente_nome))
- `idx_orcamentos_vendedor_status` (vendedor_id, status, criado_em DESC)
- `idx_orcamentos_cliente_id` (cliente_id)

Sequência: `orcamento_numero_seq` (START 1, INCREMENT 1).

### `clientes`
Base importada do Tiny/Bling + cadastros via WhatsApp/painel.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `externo_id` | TEXT UNIQUE | NULL | ID no Tiny/Bling |
| `codigo` | TEXT | NULL | Código interno |
| `nome` | TEXT NOT NULL | — | Razão social |
| `fantasia` | TEXT | NULL | Nome fantasia |
| `tipo_pessoa` | TEXT | NULL | "Pessoa Física" / "Pessoa Jurídica" |
| `cpf_cnpj` | TEXT | NULL | Formatação livre |
| `ie_rg` | TEXT | NULL | |
| `ie_isento` | TEXT | NULL | |
| `endereco` | TEXT | NULL | |
| `numero` | TEXT | NULL | |
| `complemento` | TEXT | NULL | |
| `bairro` | TEXT | NULL | |
| `cep` | TEXT | NULL | 8 dígitos |
| `cidade` | TEXT | NULL | |
| `uf` | TEXT | NULL | |
| `fone` | TEXT | NULL | |
| `celular` | TEXT | NULL | |
| `email` | TEXT | NULL | |
| `email_nfe` | TEXT | NULL | |
| `contatos` | TEXT | NULL | Texto livre |
| `data_nascimento` | DATE | NULL | |
| `tipo_contato` | TEXT | NULL | "Cliente" / "Fornecedor" / etc. |
| `vendedor` | TEXT | NULL | Texto livre, vendedor responsável legado |
| `observacoes` | TEXT | NULL | |
| `regime_tributario` | TEXT | NULL | |
| `cliente_desde` | DATE | NULL | |
| `limite_credito` | NUMERIC(12,2) | 0 | Reservado p/ futura validação de crédito |
| `situacao` | TEXT | 'Ativo' | Texto livre, vem do Tiny |
| `ativo` | BOOLEAN | true | Soft delete |
| `criado_em` | TIMESTAMP | now() | |
| `atualizado_em` | TIMESTAMP | NULL | |

Índices:
- `trgm_idx_clientes_nome` GIN (lower(nome) gin_trgm_ops)
- `trgm_idx_clientes_fantasia` GIN (lower(coalesce(fantasia,'')) gin_trgm_ops)
- `idx_clientes_cpf_cnpj` (cpf_cnpj)
- `idx_clientes_externo_id` (externo_id)
- `idx_clientes_ativo_nome` (ativo, lower(nome))

### `system_config`
Singleton com configurações globais. PK fixa `'default'`.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | VARCHAR(50) PK | 'default' | Único registro |
| `core_prompt` | TEXT NOT NULL | (regras default) | Editado pelo admin no painel |
| `session_timeout_hours` | INTEGER | 2 | Inatividade que encerra a sessão |

### `users` (Fase 1a)
Login do painel administrativo. Não tem nada a ver com `vendedores` (que é o cadastro de WhatsApp), mas pode ser vinculado a um vendedor via `vendedor_id` para isolar a visão (sub-login + vendedor_id → só enxerga os próprios orçamentos).

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `email` | TEXT UNIQUE NOT NULL | — | Indexado por `lower(email)` |
| `password_hash` | TEXT NOT NULL | — | bcrypt cost 10 |
| `nome` | TEXT NOT NULL | — | Exibido no header |
| `role` | TEXT NOT NULL | 'sub' | CHECK in (admin, sub). Admin tem todas as permissões implicitamente. |
| `vendedor_id` | UUID FK → vendedores | NULL | Se preenchido + role='sub', dispara o isolamento por vendedor |
| `permissions` | JSONB NOT NULL | '[]' | Array de strings — ver `api/lib/auth.ts` `PERMISSIONS` |
| `ativo` | BOOLEAN | true | Desativar = soft-delete |
| `criado_em` | TIMESTAMP | now() | |
| `ultimo_login` | TIMESTAMP | NULL | Setado em cada login bem-sucedido |
| `criado_por` | UUID FK → users | NULL | Quem criou esse usuário (SET NULL on delete) |

Índices:
- `idx_users_email` (lower(email))
- `idx_users_vendedor_id` (vendedor_id)

**Bootstrap do admin inicial:** se a tabela está vazia no boot, cria um admin com email/senha de `ADMIN_INITIAL_EMAIL` + `ADMIN_INITIAL_PASSWORD` (env). Senha precisa ter ≥8 chars.

**Permissions disponíveis** (subset, ver fonte para a lista canônica): `products.view`, `products.edit`, `products.import`, `clientes.view`, `clientes.edit`, `clientes.delete`, `orcamentos.view`, `orcamentos.edit`, `vendas.view`, `vendedores.view`, `vendedores.edit`, `historico.view`, `config.view`, `config.edit`, `dashboard.view`, `users.manage`.

### `ai_usage` (Fase 1c)
Log de cada chamada de chat completion à OpenAI — tokens, modelo, custo estimado em USD. Whisper **não** está aqui (a API não retorna usage). Habilita o card "Custo do mês" do dashboard (Fase 2) e relatórios por vendedor/modelo.

| Coluna | Tipo | Default | Nota |
|---|---|---|---|
| `id` | UUID PK | uuid_generate_v4() | |
| `vendedor_id` | UUID FK → vendedores | NULL | SET NULL no delete (preserva agregado histórico) |
| `sessao_id` | UUID FK → sessoes | NULL | SET NULL no delete |
| `mensagem_id` | UUID FK → mensagens | NULL | Hoje sempre NULL — extract/final rodam fora da janela de gravação da mensagem. Mantido para vínculo futuro. |
| `model` | TEXT NOT NULL | — | Ex: `gpt-4.1`, `gpt-4o` |
| `purpose` | TEXT | NULL | `extract` \| `final` \| `vision` (livre) |
| `prompt_tokens` | INTEGER NOT NULL | 0 | |
| `completion_tokens` | INTEGER NOT NULL | 0 | |
| `total_tokens` | INTEGER NOT NULL | 0 | |
| `cost_usd` | NUMERIC(12, 6) NOT NULL | 0 | **Snapshot** computado em `api/lib/ai.ts` no momento da call. Pricing atualizado lá. |
| `created_at` | TIMESTAMP | now() | |

Índices:
- `idx_ai_usage_created_at` (created_at DESC)
- `idx_ai_usage_vendedor_created` (vendedor_id, created_at DESC)
- `idx_ai_usage_model_created` (model, created_at DESC)

**Gravação:** fire-and-forget em `recordUsage()` — falha de insert é logada mas não bloqueia a resposta ao vendedor.

## Shapes JSONB

### `orcamentos.itens`
Array. Cada item:
```json
{
  "descricao": "WHEY GOLD STANDARD 2KG",
  "marca": "OPTIMUM NUTRITION",
  "qtd": 10,
  "preco_unit": 289.90,
  "subtotal": 2899.00
}
```

### `sessoes.acao_pendente`

Aguardando confirmação de fechar venda:
```json
{ "tipo": "fechar_venda", "numero": "ORC-000123" }
```

Aguardando confirmação de cancelamento:
```json
{ "tipo": "cancelar", "numero": "ORC-000123" }
```

Aguardando escolha de cliente para finalizar/alterar orçamento:
```json
{
  "tipo": "selecionar_cliente",
  "fn": "finalizar_orcamento" | "alterar_orcamento",
  "candidatos": [{ "id": "uuid", "nome": "...", "fantasia": "...", "cpf_cnpj": "...", "cidade": "...", "uf": "...", "fone": "...", "celular": "...", "externo_id": "...", "score": 0.85, "match_type": "fuzzy" }],
  "nome_sugerido": "termo de busca original",
  "itens": [...],
  "total": 1234.50,
  "numero_alvo": "ORC-000123" | null
}
```

Aguardando escolha de cliente para edição (fora de orçamento):
```json
{
  "tipo": "selecionar_cliente_edicao",
  "candidatos": [...],
  "campos": { "fone": "...", "endereco": "..." }
}
```

## Convenções

- **`criado_em` / `atualizado_em`**: TIMESTAMP sem timezone (UTC implícito pelo Supabase).
- **Soft delete**: `ativo = false` em `clientes` e `products`. Nada é deletado fisicamente.
- **Snapshot em `orcamentos.cliente_nome`**: o nome é gravado junto. Se o cliente for renomeado depois, o orçamento mantém o nome original. Para o nome atual, JOIN via `cliente_id`.
- **`externo_id` em `clientes`**: ID do Tiny/Bling, usado para upsert idempotente em re-imports.
- **`vendedores.numero_whatsapp`**: sem sufixo `@s.whatsapp.net` nem `@lid`.

## Migrações pendentes / planejadas

Documentar aqui ao introduzir nova migration. Hoje vazio — todo o schema está em `initDB()`.

> **Fase 1c** introduz `ai_usage` para tracking de custo da OpenAI por mensagem. **Fase 3** pode adicionar caching de PDFs gerados se a geração on-the-fly virar gargalo.
