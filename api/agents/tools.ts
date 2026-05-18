// Function definitions para o agente final. Mantidas separadas para clareza.

import type OpenAI from 'openai';

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export const tools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'alterar_orcamento',
      description: 'Atualiza um orçamento existente em aberto. Use APENAS quando estiver no MODO ALTERAÇÃO indicado no prompt. Substitui a lista completa de itens pelo novo conjunto fornecido.',
      parameters: {
        type: 'object',
        required: ['numero', 'cliente_nome', 'itens', 'total'],
        properties: {
          numero: {
            type: 'string',
            description: 'Número do orçamento a alterar (formato ORC-000123). Use o número indicado no MODO ALTERAÇÃO do prompt.',
          },
          cliente_nome: {
            type: 'string',
            description: 'Nome do cliente. Mantenha o nome atual se o vendedor não pediu mudança.',
          },
          itens: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['descricao', 'qtd', 'preco_unit', 'subtotal'],
              properties: {
                descricao: { type: 'string' },
                marca: { type: 'string' },
                qtd: { type: 'number' },
                preco_unit: { type: 'number' },
                subtotal: { type: 'number' },
              },
            },
          },
          total: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cadastrar_cliente',
      description: 'Cadastra um cliente novo na base. Use APENAS quando o vendedor pedir explicitamente para cadastrar um cliente (fora do fluxo de orçamento). Nome é obrigatório. Outros campos preencha somente se o vendedor passou.',
      parameters: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome: { type: 'string', description: 'Nome do cliente. Obrigatório.' },
          fantasia: { type: 'string' },
          tipo_pessoa: { type: 'string', enum: ['Pessoa Física', 'Pessoa Jurídica'] },
          cpf_cnpj: { type: 'string' },
          fone: { type: 'string' },
          celular: { type: 'string' },
          email: { type: 'string' },
          endereco: { type: 'string' },
          numero: { type: 'string' },
          complemento: { type: 'string' },
          bairro: { type: 'string' },
          cidade: { type: 'string' },
          uf: { type: 'string' },
          cep: { type: 'string' },
          tipo_contato: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_cliente',
      description: 'Atualiza dados de um cliente já cadastrado. O sistema busca o cliente pela query (nome, fantasia, CPF/CNPJ ou ID). Se houver mais de um match, o sistema pede pro vendedor escolher antes de aplicar.',
      parameters: {
        type: 'object',
        required: ['query', 'campos'],
        properties: {
          query: { type: 'string', description: 'Identificador do cliente passado pelo vendedor — pode ser nome, fantasia, CPF/CNPJ ou ID externo.' },
          campos: {
            type: 'object',
            description: 'Mapa de campos a atualizar. Use apenas os campos que o vendedor pediu pra mudar.',
            properties: {
              nome: { type: 'string' },
              fantasia: { type: 'string' },
              tipo_pessoa: { type: 'string' },
              cpf_cnpj: { type: 'string' },
              fone: { type: 'string' },
              celular: { type: 'string' },
              email: { type: 'string' },
              email_nfe: { type: 'string' },
              endereco: { type: 'string' },
              numero: { type: 'string' },
              complemento: { type: 'string' },
              bairro: { type: 'string' },
              cidade: { type: 'string' },
              uf: { type: 'string' },
              cep: { type: 'string' },
              tipo_contato: { type: 'string' },
              observacoes: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finalizar_orcamento',
      description: 'Finaliza o orçamento atual. Chamar SOMENTE depois que o vendedor confirmar de forma clara todos os itens e quantidades E tiver informado o nome do cliente.',
      parameters: {
        type: 'object',
        required: ['cliente_nome', 'itens', 'total'],
        properties: {
          cliente_nome: {
            type: 'string',
            description: 'Nome do cliente final. OBRIGATÓRIO. Se o vendedor ainda não informou, PERGUNTE antes de chamar esta função — NUNCA invente.',
          },
          itens: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['descricao', 'qtd', 'preco_unit', 'subtotal'],
              properties: {
                descricao: { type: 'string' },
                marca: { type: 'string' },
                qtd: { type: 'number' },
                preco_unit: { type: 'number' },
                subtotal: { type: 'number' },
              },
            },
          },
          total: { type: 'number' },
        },
      },
    },
  },
];

export const SUPPORTED_FN_NAMES = new Set([
  'finalizar_orcamento',
  'alterar_orcamento',
  'cadastrar_cliente',
  'editar_cliente',
]);
