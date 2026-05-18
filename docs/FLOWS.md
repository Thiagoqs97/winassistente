# Fluxos críticos — WIN Distribuidora

Este documento descreve **passo a passo** os fluxos não-óbvios do sistema. Se você precisa entender por que o agente fez X em uma sessão, comece aqui.

## 1. Fluxo de mensagem (webhook do Evolution)

Ver `docs/ARCHITECTURE.md` "Pipeline da mensagem no webhook" para o passo-a-passo numerado de 16 etapas. Resumo:

1. Webhook valida evento `messages.upsert` ignorando `fromMe` e grupos.
2. Decodifica mídia → texto (Whisper, GPT-4o vision, xlsx, CSV).
3. Carrega vendedor + sessão (cria se necessário, encerra por timeout).
4. **Curto-circuita** em onboarding ou em ações pendentes (não chama IA).
5. Extrator de intent classifica a mensagem e devolve JSON estruturado.
6. Roteia intents administrativas (`listar_abertos`, `buscar_por_cliente`, `fechar_venda`, `cancelar_orcamento`) com respostas determinísticas.
7. Para `pedido` ou `alterar_orcamento`: busca produtos → final LLM com tools → tool call ou texto livre.
8. Resposta enviada ao Evolution + gravada em `mensagens` + ack 200 ao webhook.

## 2. Onboarding do vendedor

Disparado quando um número novo manda mensagem **ou** quando `vendedores.nome IS NULL`.

```
mensagem recebida
   │
   ▼
vendedor.nome IS NULL?
   ├─ não → segue fluxo normal
   └─ sim:
       grava mensagem do vendedor
       já enviei mensagem do assistant nesta sessão?
         ├─ não → envia "Olá! Sou o assistente da Win Distribuidora. Qual o seu nome?"
         └─ sim:
             parseNomeVendedor(mensagem) retorna nome válido?
               ├─ sim → UPDATE vendedores.nome + "Prazer, {nome}!"
               └─ não → "Não consegui identificar seu nome..."
       fim — não roda extractor nem busca
```

**Por quê:** sem nome do vendedor, todos os orçamentos ficam órfãos no painel. Bloqueia explicitamente.

## 3. Gestão de sessão

Cada vendedor tem **no máximo 1 sessão ativa**. Critérios de transição:

| Origem | Disparador | Resultado |
|---|---|---|
| Nenhuma sessão ativa | mensagem chegou | cria sessão |
| Sessão ativa | última mensagem há > `session_timeout_hours` (default 2h) | encerra sessão + cria nova |
| Sessão ativa | extrator retorna `new_session: true` | encerra sessão + cria nova + zera history |
| Sessão ativa | `finalizar_orcamento` ou `alterar_orcamento` executado | status → `orcamento_gerado` + `encerrada_em = NOW()` |

**Histórico** é a sequência de `mensagens.papel/conteudo` da sessão atual ordenada por `criado_em`. Vai inteira para o LLM (a regra "truncate ao limite de tokens" do PRD ainda não é necessária — sessões raramente passam de 30 mensagens).

## 4. Geração de orçamento (finalizar_orcamento)

```
vendedor confirma os itens
   │
   ▼
LLM emite tool_call finalizar_orcamento(cliente_nome, itens, total)
   │
   ▼
backend valida: itens.length > 0 e total > 0
cliente_nome presente?
   ├─ não → "Antes de fechar, preciso do nome do cliente para esse orçamento."
   └─ sim → resolverClienteEGravar(query = cliente_nome)
              │
              ▼
       searchClientes(query, 6)
              │
              ├─ 0 matches  → set acao_pendente = selecionar_cliente (candidatos=[])
              │              → "Não achei cliente. Quer cadastrar {nome}?"
              │
              ├─ 1 match forte (documento/externo_id/telefone/fuzzy≥0.7)
              │              → gravarOrcamento direto com esse cliente
              │
              └─ múltiplos ou fuzzy fraco
                             → set acao_pendente = selecionar_cliente (candidatos=matches)
                             → "Achei N clientes: 1. ..., 2. ..."
```

`gravarOrcamento`:
1. `SELECT nextval('orcamento_numero_seq')` → padrão `ORC-NNNNNN`.
2. `INSERT INTO orcamentos (numero, sessao_id, vendedor_id, cliente_id, cliente_nome, itens, total)`.
3. `UPDATE sessoes SET status='orcamento_gerado', encerrada_em=NOW()`.
4. Formata texto do orçamento via `formatarTextoOrcamento`.
5. Envia via WhatsApp + grava em `mensagens`.

## 5. Modo alteração de orçamento

Disparado por `intent: 'alterar_orcamento'` do extrator.

1. Backend valida que `ref_numero` foi extraído + orçamento existe + está em `aberto`.
2. Carrega `orcamentoEmAlteracao = { numero, cliente_nome, itens, total }`.
3. Injeta um bloco no system prompt do LLM com os itens atuais e a regra: chame `alterar_orcamento`, não `finalizar_orcamento`.
4. LLM interpreta o que mudou (adicionar/remover/trocar) e propõe a lista FINAL.
5. Vendedor confirma → LLM chama `alterar_orcamento(numero, cliente_nome, itens, total)`.
6. `gravarOrcamento(fnName='alterar_orcamento')` faz `UPDATE orcamentos SET itens=..., total=..., atualizado_em=NOW() WHERE numero AND vendedor_id AND status='aberto'`.

**Não cria novo orçamento.** Se status não for `aberto`, retorna erro.

## 6. Ações pendentes (state machine)

`sessoes.acao_pendente` é a forma do backend "lembrar" do que o vendedor estava decidindo. Consumido na próxima mensagem.

```
sem pendente
    │ vendedor pediu "fechar ORC-X"
    ▼
acao_pendente = {tipo: 'fechar_venda', numero: 'ORC-X'}
    │
    ├─ próxima msg = "sim" → UPDATE orcamentos SET status='venda' + limpa pendente
    ├─ próxima msg = "não" → mantém orçamento + limpa pendente
    └─ próxima msg = ambígua → limpa pendente, segue fluxo normal (vendedor mudou de assunto)
```

Mesmo padrão para `tipo: 'cancelar'` e `tipo: 'selecionar_cliente'` / `tipo: 'selecionar_cliente_edicao'`.

**Parsers** (em `services/intents.ts`):
- `parseConfirmacao(text)` → `'sim' | 'nao' | 'ambiguo'`
- `parseEscolha(text, totalOpcoes)` → `{kind: 'numero', idx} | {kind: 'novo'} | {kind: 'cancela'} | {kind: 'ambiguo'}`. Aceita números diretos, ordinais ("primeiro", "segundo"), "novo", "cancela".

## 7. Busca de produto (multi-estratégia)

A função `searchProducts(terms[])` retorna `[{term, products}, ...]`. Cada termo passa por 3 estratégias e o resultado é deduplicado e rankeado.

```
para cada termo:
   Strategy 1+2 (batched, 1 query SQL única para TODOS os termos):
     similarity(unaccent(lower(descricao)), unaccent(lower(termo))) > 0.08
     OU descricao ILIKE '%termo%'  (bônus 0.5)
     ORDER BY sml DESC, id ASC
     LIMIT MAX_PER_TERM (30)

   Strategy 3 (keyword AND, 1 query por termo se strong.length > 0):
     normalizeTerm + extractKeywords
     strong = palavras ≥3 chars não-stop (peso alto, AND)
     weak   = números + unidades (peso baixo, bônus)
     ILIKE concat de strong com AND + bônus por weak
     sml = 0.3 + soma_bonus
   merge: se Strategy 3 deu sml maior, atualiza

ordena por sml DESC, id ASC, slice(0, 30)
```

**MAX_PER_TERM = 30** é intencional. Quando o vendedor pergunta "quais sabores do X?", o agente precisa listar TODAS as variações — o prompt instrui "se o grupo trouxe 12 sabores, mostre os 12. A lista é a fonte de verdade."

`normalizeTerm`: separa número de unidade (`"300g"` → `"300 g"`, `"1kg"` → `"1 kg"`).
`STOP_WORDS`: `de, da, do, das, dos, com, sem, para, por, em, no, na, ...` (PT-BR comuns).

## 8. Busca de cliente

`searchClientes(query)` é multi-estratégia e prioriza match exato:

| Ordem | Tipo de match | Disparo | Resultado |
|---|---|---|---|
| 1 | `externo_id` | dígitos ≥8 | exact match no externo_id (1) |
| 2 | `documento` | CPF/CNPJ (dígitos ≥11) | regex match no cpf_cnpj |
| 3 | `telefone` | dígitos 8-13 | LIKE em fone+celular |
| 4 | `fuzzy` | trigram + ILIKE em nome/fantasia | sml > 0.18, ORDER BY sml DESC |
| 5 (fallback) | keyword AND | nada do 1-4 | tokens AND no nome+fantasia |

**Match forte** (passa direto sem perguntar): `documento`, `externo_id`, `telefone`, ou `fuzzy` com score ≥ 0.7.

**Match fraco ou múltiplos**: cria `acao_pendente: selecionar_cliente` e pergunta.

## 9. Mídia: como cada tipo vira texto

| Tipo | Processamento | Custo |
|---|---|---|
| Áudio (`audioMessage`) | `whisper-1` em PT, language='pt' | $0.006/min |
| Imagem (`imageMessage`) | `gpt-4o` com prompt "extraia produtos e quantidades" → "Produto - Quantidade" | ~$0.005-0.02 |
| Planilha xlsx | `xlsx.read` + sheet_to_json com `header: 1` (primeiras 200 linhas) → string `"col1 \| col2 \| ..."` | $0 |
| CSV | Decode UTF-8, primeiros 4000 chars | $0 |
| PDF | **Não implementado** (mesmo declarado em `tipo_midia`) | — |

Texto resultante segue o pipeline normal.

## 10. Importação de estoque (upload-stock)

1. Frontend lê arquivo → base64 → POST `/api/upload-stock` (JSON).
2. Backend decodifica → `xlsx.read` → `sheet_to_json`.
3. Mapeamento por colunas (busca por nome exato OU substring — case-insensitive). Pega:
   - **Descrição**: `descrição`, `descricao`, `desc`, `nome`, `produto`, etc.
   - **Código**: `código`, `codigo`, `cod`, `sku`, `código interno`, etc.
   - **Preço de venda**: lista grande de fallbacks (`tipo integração b2b venda`, `sugerir preço de venda baseado`, `preço de venda`, `preço`, `valor`, etc.).
   - **Marca**: descarta valores que parecem ID numérico, prefere textual.
   - **Embalagem, categoria, código de barras**.
4. Parser de preço BR: `R$ 1.234,50` → `1234.50`.
5. **`DELETE FROM products`** + INSERT em chunks de 500 com `ON CONFLICT (codigo) DO UPDATE`.
6. Devolve `{N} produtos importados (M ignorados)`.

> Atenção: é um truncate-and-insert. Se o upload falhar no meio, faz ROLLBACK. Mas `ativo=false` é perdido em cada import — vai precisar repensar se o admin quiser preservar customizações.

## 11. Configuração do webhook no Evolution

Botão "Configurar Webhook Agora" em `SettingsTab`:

```
POST /api/setup-webhook { appUrl: VITE_APP_URL }
   │
   ▼
backend faz POST {EVO_URL}/webhook/set/{EVO_INSTANCE} com:
   {
     webhook: {
       enabled: true,
       url: `${appUrl}/api/webhook/evolution`,
       webhookByEvents: false,
       webhookBase64: true,
       events: ['MESSAGES_UPSERT']
     }
   }
```

`webhookBase64: true` é o que faz o Evolution mandar áudios/imagens/documentos como base64 inline em `msg.base64`.

## 12. Edge cases conhecidos

- **Conta WhatsApp Business** vem com `remoteJid: '...@lid'` e `remoteJidAlt: '...@s.whatsapp.net'`. Preferimos o alt.
- **Grupos** (`@g.us`) são ignorados — o agente é 1:1 só.
- **Mensagem sem texto** (sticker, location, contato) cai no `if (!incomingText) return;` silenciosamente.
- **Texto idêntico ao último** não é deduplicado — se o Evolution reentregar a mesma mensagem, é processada de novo. (Idempotência via `message_id` está no roadmap.)
- **Vendedor que muda de assunto no meio de uma ação pendente ambígua**: o backend limpa o pendente e segue o fluxo normal. Sem reset, ficaria preso.
- **Orçamento alterado para nenhum item** não é permitido (`itens.length === 0` é rejeitado antes do UPDATE).
