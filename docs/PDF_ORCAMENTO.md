# Template do PDF de Orçamento

Padrão visual a ser respeitado no PDF nativo do sistema (Fase 3, item 2.9/5.1). Baseado no modelo atualmente usado pela WIN, exportado do Bling/Tiny.

## Layout (página A4 retrato)

```
┌────────────────────────────────────────────────────────────────────┐
│ Bling - Pedido de Venda                          13/05/2026, 16:27 │ ← cabeçalho fino (data emissão)
│                                                                    │
│  ┌──────┐                          E S L S LTDA - (86) 99568-3559  │
│  │ WIN  │                          Rua Waldemar Rocha, N° 3213     │
│  │ DIST.│                          64078640 - Teresina, PI         │
│  └──────┘                          CNPJ: 57.355.738/0001-99,       │
│                                    IE: 197705260                   │
│                                                                    │
│                       ═══════════════════════                      │
│                         Pedido 5395  (título centralizado, bold)   │
│                                                                    │
│  Cliente                              ┌──────────────────┬───────┐ │
│  ─────────────────────────────────    │ Número do pedido │ 5395  │ │
│  R DE S MENESES LTDA                  ├──────────────────┼───────┤ │
│  CORPUS SUPPLEMENTS NUTRIÇÃO ESP.     │ Data             │ 13/05 │ │
│  CNPJ: 36.833.981/0001-03             ├──────────────────┼───────┤ │
│  IE: 126411719                        │ Data prevista    │       │ │
│  Praça Alcebíades silva, N° 1817,     └──────────────────┴───────┘ │
│  PONTO COMERCIAL, Bairro: CENTRO                                   │
│  Codó, MA, 65400000                                                │
│  Fone: (99)98122-3533, corpus.supplements@gmail.com                │
│                                                                    │
│  Vendedor                                                          │
│  ─────────────────────────────────                                 │
│  AIRINE DOS SANTOS SILVA                                           │
│                                                                    │
│  Itens do pedido de venda                                          │
│ ┌──────────────────────────────────────┬───────┬────┬─────┬───────┬───────┐
│ │ Descrição do produto/serviço         │Código │ Un.│Qtd. │Valor  │Valor  │
│ │                                      │       │    │     │unit.  │total  │
│ ├──────────────────────────────────────┼───────┼────┼─────┼───────┼───────┤
│ │ CREATINA CREAPURE 300G - DUX         │ 1381  │ UN │ 2,00│ 236,20│ 472,40│
│ │ PROTEIN CRUSH 900G - UNDER LABZ      │ 195   │ UN │ 2,00│  91,20│ 182,40│
│ │ SABOR:CHOCOBEAR                      │       │    │     │       │       │
│ │ ...                                  │       │    │     │       │       │
│ ├──────────────────────────────────────┴───────┴────┴─────┼───────┼───────┤
│ │                                          N° de itens     │       │  6,00 │
│ │                                          Soma das Qtdes  │       │ 12,00 │
│ │                                          Total de produtos       │1384,40│
│ │                                          Total do pedido         │1384,40│
│ └──────────────────────────────────────────────────────────┴───────┴───────┘
│                                                                    │
│  Observações                                                       │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │                                                                │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ https://www.bling.com.br/relatorios/venda.impressao.php  Página 1/1│ ← rodapé fino
└────────────────────────────────────────────────────────────────────┘
```

## Conteúdo por bloco

### 1. Cabeçalho (uma linha fina, fonte ~8pt cinza)
- À esquerda: `WIN Distribuidora — Orçamento` (substitui o "Bling - Pedido de Venda").
- À direita: data e hora de emissão no formato `dd/mm/aaaa, HH:MM`.

### 2. Identificação da empresa (topo)
- **Logo WIN** (azul escuro com texto "WIN DISTRIBUIDORA" branco) — alinhada à esquerda.
- **Dados da WIN** alinhados à direita, fonte ~9pt, **right-aligned**:
  ```
  E S L S LTDA - (86) 99568-3559
  Rua Waldemar Rocha, N° 3213
  64078640 - Teresina, PI
  CNPJ: 57.355.738/0001-99, IE: 197705260
  ```

### 3. Título do documento
- Centralizado, bold, fonte ~16-18pt: `Orçamento ORC-NNNNNN`
  (substitui o "Pedido 5395" do modelo Bling).

### 4. Bloco "Cliente" (lado esquerdo) + Bloco "Número/Data" (lado direito)

**Cliente** (caixa fina ou área separada com label `Cliente` em bold acima):
- Linha 1: nome (razão social ou nome PF) em bold.
- Linha 2: nome fantasia (se diferente do nome).
- Linha 3: `CNPJ: …` ou `CPF: …`, `IE: …`.
- Linha 4: endereço completo formatado: `endereco, N° numero, complemento, Bairro: bairro`.
- Linha 5: `cidade, UF, CEP`.
- Linha 6: `Fone: fone/celular, email`.

> Campos ausentes são omitidos; nunca renderizar "null" ou "—".

**Número/Data** (tabela 2 colunas, lado direito):
| | |
|---|---|
| Número do pedido | `ORC-NNNNNN` (sem o prefixo "ORC-" pode ser uma opção, ver com Win) |
| Data | dd/mm/aaaa |
| Data prevista | (vazio por enquanto — campo não existe ainda) |

### 5. Bloco "Vendedor"
- Label `Vendedor` em bold acima de uma caixa.
- Conteúdo: nome do vendedor (`vendedores.nome`). Em uppercase como o modelo.

### 6. Tabela de itens — "Itens do pedido de venda"

Cabeçalho da tabela (label em bold acima):

| Descrição do produto/serviço | Código | Un. | Qtd. | Valor unitário | Valor total |
|---|---|---|---|---|---|

Linhas:
- **Descrição**: nome do produto + marca (se não embutida no nome). Variação (sabor/tamanho) na segunda linha em fonte menor cinza, como `SABOR:CHOCOBEAR`.
- **Código**: código interno do produto.
- **Un.**: unidade (default `UN`).
- **Qtd.**: quantidade com 2 casas (`2,00`).
- **Valor unitário**: BR sem `R$`, com vírgula e 2 casas (`236,20`).
- **Valor total**: idem (`472,40`).

Rodapé da tabela (4 linhas alinhadas à direita):
```
N° de itens          6,00
Soma das Qtdes      12,00
Total de produtos 1.384,40
Total do pedido   1.384,40
```

`N° de itens` = `itens.length`. `Soma das Qtdes` = `Σ qtd`. `Total de produtos` e `Total do pedido` são iguais hoje (não temos frete/desconto).

### 7. Bloco "Observações"
- Label `Observações` em bold.
- Caixa retangular vazia (placeholder para texto livre futuro).

### 8. Rodapé
- Esquerda: URL do sistema (`https://winassistente.vercel.app/orcamentos/ORC-NNNNNN` quando tivermos rota pública, ou só `WIN Distribuidora`).
- Direita: `Página 1 de 1` (paginar se >1).

## Cores e tipografia

- **Cor primária** (logo, títulos): azul escuro do logo WIN (~`#1a3a8a` — confirmar com a marca).
- **Linhas de tabela**: cinza médio (`#999999` ou `#888`).
- **Texto principal**: preto/quase-preto.
- **Texto secundário** (cabeçalho/rodapé fino, sabor/variação): cinza (`#666`).
- **Fonte**: sans-serif (Arial, Helvetica, ou similar). 10pt corpo, 8pt cabeçalhos finos, 16pt título.

## Dados disponíveis no backend (mapeamento)

| Campo no PDF | Origem |
|---|---|
| Número | `orcamentos.numero` |
| Data | `orcamentos.criado_em` (dd/mm/aaaa) |
| Data prevista | vazio (não implementado) |
| Cliente nome | `orcamentos.cliente_nome` ou JOIN `clientes.nome` |
| Cliente fantasia | JOIN `clientes.fantasia` |
| Cliente CNPJ/CPF | JOIN `clientes.cpf_cnpj` |
| Cliente IE | JOIN `clientes.ie_rg` |
| Cliente endereço | JOIN `clientes.endereco`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `cep` |
| Cliente contato | JOIN `clientes.fone`, `celular`, `email` |
| Vendedor | `vendedores.nome` via `orcamentos.vendedor_id` |
| Itens | `orcamentos.itens` (JSONB array) — campos `descricao`, `marca`, `qtd`, `preco_unit`, `subtotal` |
| Total | `orcamentos.total` |

> **Variação/sabor**: se `descricao` contém uma string como `SABOR:CHOCOBEAR` ou `300G`, render na segunda linha da célula. O backend hoje guarda variação no próprio `descricao` (não há coluna separada `variacao`).

## Implementação prevista (Fase 3)

Biblioteca a escolher: **PDFKit** (gerador nativo, mais flexível) ou **@react-pdf/renderer** (declarativo, JSX). Decisão na hora de implementar — anotar aqui o que foi escolhido e por quê.

Saída: `Buffer` retornado por `/api/orcamentos/:numero/pdf` (GET) ou enviado como anexo via Evolution (`documentMessage` com base64).
