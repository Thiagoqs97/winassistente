\# WIN DISTRIBUIDORA – Suplementos Esportivos

\## Documento de Requisitos de Produto (PRD)

\### Sistema de Vendas via WhatsApp com IA



| Campo | Detalhe |

|---|---|

| \*\*Versão\*\* | 2.0 |

| \*\*Data\*\* | Maio de 2026 |

| \*\*Classificação\*\* | Confidencial – uso interno |

| \*\*Responsável\*\* | Win Distribuidora |



\---



\## 1. Visão Geral do Projeto



\### 1.1 Contexto



A Win Distribuidora atende vendedores internos e representantes externos. O processo de recebimento de listas de pedidos e consultas via WhatsApp gera um volume de requisições que precisa ser tratado de forma ágil e autônoma, sem depender de uma equipe de atendimento intermediária.



Este projeto cria um sistema onde um agente de IA responde diretamente aos vendedores no WhatsApp: interpreta pedidos em qualquer formato (texto, áudio, imagem, PDF ou planilha), realiza busca inteligente no estoque, monta o orçamento completo e o envia de volta ao vendedor — tudo de forma automatizada.



Um painel web administrativo complementa o sistema para gestão de estoque e configurações.



\### 1.2 Objetivo



Criar uma solução inteligente e autônoma que permita:



\- Vendedores enviarem pedidos por texto, áudio, imagem, PDF ou planilha via WhatsApp.

\- O sistema mapear com precisão os produtos no banco de dados usando busca fuzzy, sem sobrecarregar o contexto da IA.

\- O agente de IA confirmar os itens identificados com o vendedor e gerar o orçamento final automaticamente.

\- O histórico de cada conversa ser mantido por número de WhatsApp, garantindo contexto multi-mensagem e isolamento entre sessões distintas.



\### 1.3 Fora do Escopo (versão 2.0)



Os itens abaixo não fazem parte desta versão:



\- Integração automática com o sistema Winthor (importação de estoque permanece manual via Excel).

\- Módulo financeiro ou emissão de nota fiscal.

\- Notificações para equipe humana intermediária.



\---



\## 2. Stakeholders e Usuários



| Perfil | Função | Interação com o sistema |

|---|---|---|

| \*\*Administrador\*\* | Gestor da distribuidora | Painel web: importação de estoque, configurações gerais e edição de prompts. |

| \*\*Agente de IA\*\* | Atendente virtual no WhatsApp | Processa mensagens, mantém histórico por sessão, busca produtos e gera orçamentos. |

| \*\*Vendedor\*\* | Representante interno ou externo | WhatsApp: envia pedidos por texto, áudio, imagem ou arquivo e recebe o orçamento diretamente. |



> \*\*Observação:\*\* Não existe perfil de "Atendimento Humano" nesta versão. O agente de IA é o único responsável pelo atendimento e pela geração de orçamentos.



\---



\## 3. Arquitetura Técnica



\### 3.1 Stack Tecnológico



| Camada | Tecnologia | Papel |

|---|---|---|

| Gateway WhatsApp | Evolution API | Recebe/envia mensagens do WhatsApp |

| Banco de dados | Supabase (PostgreSQL) | Estoque, histórico de conversas e motor de busca fuzzy |

| IA – Triagem Rápida | GPT-4o-mini / GPT-4.1 | Extrai intenção, identifica termos de busca e gera orçamento |

| IA – Arquivos | GPT-4o / GPT-4.1 | Lê planilhas xlsx, PDFs e fotos de listas |

| Backend / API | Node.js | Orquestra webhooks, sessões, busca fuzzy no Supabase e chamadas de IA |



\### 3.2 Fluxo de Processamento com Gestão de Sessões



Para manter custos baixos e tempos de resposta rápidos (< 2s para texto), o sistema combina busca fuzzy com gerenciamento de histórico por sessão:



1\. \*\*Recepção:\*\* Vendedor envia mensagem pelo WhatsApp (ex: \*"Quero 10 unidades de Whey Gold 2kg e 5 de Creatina"\*).

2\. \*\*Identificação:\*\* O backend identifica o número do vendedor e recupera a sessão ativa no Supabase (se existir).

3\. \*\*Extração:\*\* A IA extrai os termos de busca de cada item mencionado.

4\. \*\*Busca Fuzzy (pg\_trgm):\*\* O backend consulta o Supabase pelos produtos com nomes mais próximos ao termo extraído (top 5 por item).

5\. \*\*Resolução:\*\* A IA recebe o histórico da sessão + os resultados filtrados do estoque e cruza a intenção do vendedor com os produtos reais.

6\. \*\*Confirmação:\*\* Se necessário, a IA solicita confirmação dos itens ao vendedor antes de fechar o orçamento.

7\. \*\*Geração do Orçamento:\*\* Após confirmação, a IA monta e envia o orçamento completo diretamente na conversa.

8\. \*\*Persistência:\*\* Cada mensagem (entrada e resposta) é salva na tabela de histórico no Supabase, vinculada ao número do vendedor e à sessão atual.



\---



\## 4. Gestão de Histórico e Sessões



\### 4.1 Isolamento por Número de Vendedor



O sistema atende múltiplos vendedores simultaneamente. Cada conversa é identificada e isolada pelo número de WhatsApp do remetente. O backend garante que o histórico de um vendedor nunca seja misturado com o de outro.



\### 4.2 Controle de Sessões



Cada interação é associada a uma \*\*sessão\*\*. Uma sessão representa um ciclo de atendimento completo (desde o primeiro pedido até a entrega do orçamento). O sistema detecta automaticamente quando uma nova sessão se inicia, evitando que contextos antigos contaminem um novo pedido.



\*\*Critérios de encerramento de sessão:\*\*

\- O vendedor envia uma mensagem explicitando o início de um novo pedido (ex: \*"Agora preciso de..."\*, \*"Novo pedido"\*, \*"Olá"\* após inatividade).

\- Inatividade superior a \*\*X horas\*\* (configurável pelo administrador no painel).

\- O orçamento foi entregue e o vendedor confirma que não há mais itens.



Quando uma nova sessão é detectada, o backend cria um novo registro de sessão e o contexto enviado à IA começa do zero.



\### 4.3 Estrutura das Tabelas no Supabase



\#### Tabela: `vendedores`



| Coluna | Tipo | Descrição |

|---|---|---|

| `id` | UUID | Identificador único |

| `numero\_whatsapp` | TEXT (UNIQUE) | Número do WhatsApp no formato internacional |

| `nome` | TEXT | Nome do vendedor (opcional, preenchido pelo admin) |

| `ativo` | BOOLEAN | Se o número está habilitado a usar o sistema |

| `criado\_em` | TIMESTAMP | Data de cadastro |



\#### Tabela: `sessoes`



| Coluna | Tipo | Descrição |

|---|---|---|

| `id` | UUID | Identificador único da sessão |

| `vendedor\_id` | UUID (FK) | Referência ao vendedor |

| `iniciada\_em` | TIMESTAMP | Quando a sessão foi aberta |

| `encerrada\_em` | TIMESTAMP | Quando a sessão foi fechada (NULL = ativa) |

| `status` | TEXT | `ativa`, `encerrada`, `orcamento\_gerado` |



\#### Tabela: `mensagens`



| Coluna | Tipo | Descrição |

|---|---|---|

| `id` | UUID | Identificador único |

| `sessao\_id` | UUID (FK) | Sessão à qual pertence |

| `vendedor\_id` | UUID (FK) | Número do vendedor |

| `papel` | TEXT | `user` (vendedor) ou `assistant` (IA) |

| `conteudo` | TEXT | Texto da mensagem |

| `tipo\_midia` | TEXT | `texto`, `audio`, `imagem`, `pdf`, `planilha` |

| `criado\_em` | TIMESTAMP | Timestamp da mensagem |



\---



\## 5. Funcionalidades do Sistema



\### 5.1 Agente WhatsApp



\- \*\*Processamento Multi-formato:\*\* Suporte a texto, áudio (com transcrição), imagem (listas fotografadas), PDF e planilhas `.xlsx` enviados diretamente pelo WhatsApp.

\- \*\*Histórico Contextual:\*\* A IA recebe o histórico completo da sessão ativa a cada mensagem, podendo lidar com pedidos construídos ao longo de múltiplas mensagens.

\- \*\*Confirmação de Itens:\*\* Antes de gerar o orçamento, a IA confirma com o vendedor os produtos identificados, evitando erros por ambiguidade.

\- \*\*Geração de Orçamento:\*\* Após confirmação dos itens, a IA calcula e envia o orçamento completo com descrição, quantidade, preço unitário e total diretamente na conversa.

\- \*\*Gestão Automática de Sessões:\*\* O agente detecta transições entre sessões e inicia novo contexto quando necessário.



\### 5.2 Painel Web Administrativo



\- \*\*Importação Inteligente de Estoque:\*\* Upload direto do arquivo `.xlsx` gerado pelo Winthor. O sistema descarta colunas desnecessárias automaticamente (das 62 originais, mantém apenas 11 cruciais).

\- \*\*Gestão de Produtos:\*\* Edição manual de produtos e controle de itens inativos.

\- \*\*Configurações de Sessão:\*\* Definição do tempo de inatividade que encerra uma sessão automaticamente.

\- \*\*Configurações e Prompts:\*\* Acesso à edição das diretrizes de comportamento do Agente de IA.

\- \*\*Histórico de Conversas:\*\* Visualização do histórico de sessões e mensagens por vendedor.



\---



\## 6. Importação de Estoque



O administrador sobe a planilha bruta do Winthor sem modificar nada. O sistema mapeia automaticamente as colunas relevantes (\*\*Código, Descrição, Preço de Venda, Marca, Embalagem\*\*) e descarta as demais. A extensão `pg\_trgm` do PostgreSQL é habilitada no Supabase para suporte à busca fuzzy.



\---



\## 7. Comportamento do Agente WhatsApp



\### 7.1 Regras de Atendimento (Prompting)



As seguintes instruções são aplicadas diretamente no Core Prompt da IA:



1\. O agente \*\*tem acesso ao histórico completo da sessão ativa\*\* e deve utilizá-lo para entender pedidos construídos em múltiplas mensagens.

2\. O agente \*\*confirma os itens identificados\*\* antes de gerar qualquer orçamento, perguntando ao vendedor se os produtos encontrados correspondem ao que foi solicitado.

3\. O agente \*\*gera e envia o orçamento completo\*\* após a confirmação dos itens, sem necessidade de intervenção humana.

4\. O agente \*\*não mistura contextos de sessões diferentes\*\* — quando detecta o início de um novo pedido, trata-o de forma totalmente isolada.

5\. O agente \*\*nunca inventa produtos\*\* — trabalha exclusivamente com os itens retornados pela busca no estoque.



\### 7.2 Exemplos de Interação



\---



\*\*Exemplo 1: Pedido confirmado em uma mensagem\*\*



> \*\*Vendedor:\*\*

> Preciso de 10 unidades do Whey Gold 2kg e 5 da Creatina.



> \*\*Agente IA:\*\*

> Entendido! Identifiquei os seguintes itens no nosso estoque:

>

> 1. \*\*Whey Gold Standard 2kg – Optimum Nutrition\*\* × 10 un.

> 2. \*\*Creatina Monohidratada 300g – Growth\*\* × 5 un.

>

> Esses são os produtos certos? Confirme para eu gerar o orçamento!



> \*\*Vendedor:\*\*

> Isso mesmo.



> \*\*Agente IA:\*\*

> Perfeito! Aqui está o seu orçamento:

>

> | Produto | Qtd | Preço Un. | Total |

> |---|---|---|---|

> | Whey Gold Standard 2kg – ON | 10 | R$ 289,90 | R$ 2.899,00 |

> | Creatina Monohidratada 300g – Growth | 5 | R$ 54,90 | R$ 274,50 |

> | \*\*TOTAL\*\* | | | \*\*R$ 3.173,50\*\* |

>

> Há mais algum item para adicionar?



\---



\*\*Exemplo 2: Pedido construído em múltiplas mensagens\*\*



> \*\*Vendedor:\*\*

> Quero 20 caixas do pré-treino da Black Skull.



> \*\*Agente IA:\*\*

> Localizei: \*\*Black Skull USA Pre-Workout 300g – Black Skull\*\* × 20 un.

> É esse? E tem mais algum item?



> \*\*Vendedor:\*\*

> Sim. Adiciona também 10 unidades do BCAA da Integralmédica.



> \*\*Agente IA:\*\*

> Adicionado: \*\*BCAA 2400 – Integralmédica\*\* × 10 un.

> Mais algum item ou posso fechar o orçamento?



> \*\*Vendedor:\*\*

> Pode fechar.



> \*\*Agente IA:\*\*

> Orçamento consolidado:

>

> | Produto | Qtd | Preço Un. | Total |

> |---|---|---|---|

> | Black Skull Pre-Workout 300g | 20 | R$ 79,90 | R$ 1.598,00 |

> | BCAA 2400 – Integralmédica | 10 | R$ 39,90 | R$ 399,00 |

> | \*\*TOTAL\*\* | | | \*\*R$ 1.997,00\*\* |



\---



\*\*Exemplo 3: Nova sessão após pedido anterior\*\*



> \*\*Vendedor:\*\*

> Olá! Novo pedido aqui.



> \*\*Agente IA:\*\*

> Olá! Pode mandar a lista, estou pronto para um novo orçamento.



\*(O agente inicia nova sessão, sem carregar o histórico do pedido anterior)\*



\---



\## 8. Requisitos Não Funcionais



| Requisito | Especificação |

|---|---|

| \*\*Tempo de resposta\*\* | Busca fuzzy e triagem de texto em < 5 segundos; processamento de planilhas longas em < 20s. |

| \*\*Segurança\*\* | Chaves da OpenAI e credenciais do Supabase ocultas em variáveis de ambiente. |

| \*\*Robustez do Contexto\*\* | Histórico da sessão truncado ao limite de tokens definido; mensagens mais antigas são resumidas se necessário. |

| \*\*Isolamento Multi-vendedor\*\* | Garantia de que o histórico de um número jamais vaza para outro. |

| \*\*Consistência de Sessão\*\* | Sessões encerradas não são reabertas; nova interação após encerramento sempre cria nova sessão. |



\---



\## 9. Roadmap de Desenvolvimento



| Fase | Entregáveis | Estimativa |

|---|---|---|

| \*\*Fase 1\*\* | Supabase (tabelas de estoque, vendedores, sessões e mensagens), Evolution API, backend base e painel administrativo de estoque. | 2 semanas |

| \*\*Fase 2\*\* | Implementação da busca fuzzy (pg\_trgm), lógica de sessões e integração da IA para triagem e geração de orçamento por texto. | 2 semanas |

| \*\*Fase 3\*\* | Suporte a transcrição de áudio, leitura de imagens e planilhas. | 2 semanas |

| \*\*Fase 4\*\* | Refinamento do prompt de confirmação/orçamento, testes de stress multi-vendedor e histórico no painel admin. | 1 semana |



\---



\## 10. Critérios de Aceite



\- \*\*Busca de Produto:\*\* A API deve retornar os 5 itens mais próximos de uma pesquisa digitada incorretamente (ex: \*"uey protein"\* retornando \*"Whey Protein"\*) em menos de 1 segundo.

\- \*\*Orçamento Autônomo:\*\* O agente deve gerar orçamentos completos com valores corretos sem nenhuma intervenção humana, em 100% dos casos testados.

\- \*\*Isolamento de Sessão:\*\* Mensagens enviadas em janelas temporais distintas (acima do tempo de inatividade configurado) devem ser tratadas como sessões separadas, sem mistura de contexto.

\- \*\*Isolamento Multi-vendedor:\*\* Mensagens de números distintos jamais devem compartilhar histórico ou sessão.

\- \*\*Leitura de Documentos:\*\* Upload de planilha de pedidos via WhatsApp extraindo 95%+ de itens válidos para geração de orçamento.

\- \*\*Histórico Contextual:\*\* O agente deve ser capaz de consolidar um pedido construído em pelo menos 5 mensagens separadas e gerar o orçamento correto ao final.



\---



\*Win Distribuidora · PRD v2.0 · Maio 2026\*

