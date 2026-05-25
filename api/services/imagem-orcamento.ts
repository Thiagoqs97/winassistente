import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

// Geração do orçamento como PNG(s) usando Satori + resvg.
// Substitui o PDF no anexo enviado via WhatsApp — WhatsApp renderiza PNG
// inline como preview, o que dá melhor UX que o PDF (que vira ícone).
//
// Paginação: ~15 itens por imagem. A página 1 inclui empresa/cliente/vendedor;
// continuações trazem só o cabeçalho da tabela + itens; a última página
// adiciona totais e observações.

const W = 900;
const ITEMS_PER_FIRST_PAGE = 15;
const ITEMS_PER_NEXT_PAGE = 22;

const COR_BORDA = '#bfbfbf';
const COR_SECUNDARIA = '#666666';
const COR_HEADER_BG = '#f1f1f1';
const COR_TEXTO = '#000000';

const EMPRESA = {
  razao: 'E S L S LTDA',
  fone: '(86) 99568-3559',
  endereco: 'Rua Waldemar Rocha, N° 3213',
  cidade: '64078640 - Teresina, PI',
  cnpj: 'CNPJ: 57.355.738/0001-99',
  ie: 'IE: 197705260',
};

// ── Carregamento de assets em memória (cache singleton) ────────────────────
let fontRegular: Buffer | null = null;
let fontBold: Buffer | null = null;
let logoDataUrl: string | null = null;

function loadFonts(): { regular: Buffer; bold: Buffer } {
  if (fontRegular && fontBold) return { regular: fontRegular, bold: fontBold };
  const candidates = [
    path.join(process.cwd(), 'public', 'fonts'),
    path.join(process.cwd(), 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      const reg = fs.readFileSync(path.join(dir, 'inter-400.woff'));
      const bld = fs.readFileSync(path.join(dir, 'inter-700.woff'));
      fontRegular = reg;
      fontBold = bld;
      return { regular: reg, bold: bld };
    } catch {}
  }
  throw new Error('Fontes inter-400.woff / inter-700.woff não encontradas em public/fonts/');
}

function loadLogoDataUrl(): string | null {
  if (logoDataUrl !== null) return logoDataUrl;
  const candidates = [
    path.join(process.cwd(), 'public', 'logowin.png'),
    path.join(process.cwd(), 'logowin.png'),
  ];
  for (const p of candidates) {
    try {
      const buf = fs.readFileSync(p);
      logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
      return logoDataUrl;
    } catch {}
  }
  logger.warn('Imagem orcamento: logo logowin.png não encontrada');
  logoDataUrl = '';
  return null;
}

// ── Tipos ──────────────────────────────────────────────────────────────────
interface OrcamentoRow {
  numero: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  itens: any[];
  total: string | number;
  criado_em: string;
  status: string;
  vendedor_nome: string | null;
}

interface ClienteRow {
  nome: string;
  fantasia: string | null;
  tipo_pessoa: string | null;
  cpf_cnpj: string | null;
  ie_rg: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cep: string | null;
  cidade: string | null;
  uf: string | null;
  fone: string | null;
  celular: string | null;
  email: string | null;
}

// ── Helpers de formatação ──────────────────────────────────────────────────
function fmtBR(n: any, casas = 2): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function fmtData(iso: string | Date, comHora = false): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  if (!comHora) return `${dd}/${mm}/${yyyy}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}`;
}

function linhasCliente(c: ClienteRow | null, fallbackNome: string | null): string[] {
  if (!c) return fallbackNome ? [fallbackNome] : ['Cliente não identificado'];
  const out: string[] = [];
  out.push(c.nome.toUpperCase());
  if (c.fantasia && c.fantasia.toLowerCase() !== c.nome.toLowerCase()) {
    out.push(c.fantasia.toUpperCase());
  }
  const docs: string[] = [];
  if (c.cpf_cnpj) {
    const label = c.tipo_pessoa === 'Pessoa Física' ? 'CPF' : 'CNPJ';
    docs.push(`${label}: ${c.cpf_cnpj}`);
  }
  if (c.ie_rg) docs.push(`IE: ${c.ie_rg}`);
  if (docs.length) out.push(docs.join(', '));
  if (c.endereco) {
    let l = c.endereco;
    if (c.numero) l += `, N° ${c.numero}`;
    if (c.complemento) l += `, ${c.complemento}`;
    if (c.bairro) l += `, Bairro: ${c.bairro}`;
    out.push(l);
  }
  const cidadeUf: string[] = [];
  if (c.cidade) cidadeUf.push(c.cidade);
  if (c.uf) cidadeUf.push(c.uf);
  if (c.cep) cidadeUf.push(c.cep);
  if (cidadeUf.length) out.push(cidadeUf.join(', '));
  const contatos: string[] = [];
  const fone = c.celular || c.fone;
  if (fone) contatos.push(`Fone: ${fone}`);
  if (c.email) contatos.push(c.email);
  if (contatos.length) out.push(contatos.join(', '));
  return out;
}

// ── Construtores de nó virtual (Satori) ────────────────────────────────────
// Satori aceita árvores no formato { type, props }. Evitamos JSX no backend
// pra não exigir transform extra no esbuild.

type Node = { type: string; props: Record<string, any> } | string | null;

function el(type: string, props: Record<string, any> = {}, children: any[] | string | null = null): Node {
  return { type, props: { ...props, children } };
}

// Helper pra criar células de tabela com flexbox uniforme.
function cell(text: string, opts: { w: number; align?: 'left' | 'center' | 'right'; bold?: boolean; fontSize?: number; bg?: string; padding?: number }): Node {
  return el('div', {
    style: {
      display: 'flex',
      width: `${opts.w}px`,
      padding: `${opts.padding ?? 6}px 8px`,
      borderRight: `1px solid ${COR_BORDA}`,
      fontSize: `${opts.fontSize ?? 12}px`,
      fontWeight: opts.bold ? 700 : 400,
      justifyContent: opts.align === 'right' ? 'flex-end' : opts.align === 'center' ? 'center' : 'flex-start',
      backgroundColor: opts.bg || 'transparent',
      color: COR_TEXTO,
      wordBreak: 'break-word',
    },
  }, [text]);
}

// Larguras das colunas (somam W - 80 = 820 com 40px de margem cada lado)
const COL_W = {
  desc: 360,
  codigo: 90,
  un: 50,
  qtd: 70,
  vUnit: 110,
  vTotal: 140,
};

function tabelaHeader(): Node {
  return el('div', {
    style: {
      display: 'flex',
      border: `1px solid ${COR_BORDA}`,
      backgroundColor: COR_HEADER_BG,
    },
  }, [
    cell('Descrição do produto/serviço', { w: COL_W.desc, bold: true, fontSize: 11 }),
    cell('Código', { w: COL_W.codigo, bold: true, fontSize: 11 }),
    cell('Un.', { w: COL_W.un, bold: true, fontSize: 11, align: 'center' }),
    cell('Qtd.', { w: COL_W.qtd, bold: true, fontSize: 11, align: 'right' }),
    cell('Valor unit.', { w: COL_W.vUnit, bold: true, fontSize: 11, align: 'right' }),
    cell('Valor total', { w: COL_W.vTotal, bold: true, fontSize: 11, align: 'right' }),
  ]);
}

function tabelaRow(it: any): Node {
  const descricao = String(it.descricao || '');
  const marca = it.marca ? String(it.marca) : '';
  const codigo = it.codigo != null ? String(it.codigo) : (it.product_id != null ? String(it.product_id) : '');
  const un = it.un || 'UN';
  const qtd = Number(it.qtd || 0);
  const precoUnit = Number(it.preco_unit || 0);
  const subtotal = Number(it.subtotal != null ? it.subtotal : qtd * precoUnit);
  const tituloLinha = marca && !descricao.toUpperCase().includes(marca.toUpperCase())
    ? `${descricao} - ${marca}`
    : descricao;
  return el('div', {
    style: {
      display: 'flex',
      borderLeft: `1px solid ${COR_BORDA}`,
      borderRight: `1px solid ${COR_BORDA}`,
      borderBottom: `1px solid ${COR_BORDA}`,
    },
  }, [
    cell(tituloLinha, { w: COL_W.desc }),
    cell(codigo, { w: COL_W.codigo }),
    cell(un, { w: COL_W.un, align: 'center' }),
    cell(fmtBR(qtd), { w: COL_W.qtd, align: 'right' }),
    cell(fmtBR(precoUnit), { w: COL_W.vUnit, align: 'right' }),
    cell(fmtBR(subtotal), { w: COL_W.vTotal, align: 'right' }),
  ]);
}

function blocoCabecalhoEmpresa(): Node {
  const logo = loadLogoDataUrl();
  const empresaLinhas = [
    `${EMPRESA.razao} - ${EMPRESA.fone}`,
    EMPRESA.endereco,
    EMPRESA.cidade,
    `${EMPRESA.cnpj}, ${EMPRESA.ie}`,
  ];
  return el('div', {
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: '20px' },
  }, [
    el('div', { style: { display: 'flex', width: '80px', height: '80px', alignItems: 'center', justifyContent: 'center' } },
      logo ? [el('img', { src: logo, style: { width: '70px', height: '70px', objectFit: 'contain' } }, null)] : ['WIN']
    ),
    el('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'flex-end', fontSize: '12px', color: COR_TEXTO } },
      empresaLinhas.map(l => el('div', { style: { display: 'flex' } }, [l]))
    ),
  ]);
}

function blocoTitulo(numero: string): Node {
  return el('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px', paddingTop: '8px', paddingBottom: '8px', borderTop: `1px solid ${COR_BORDA}`, borderBottom: `1px solid ${COR_BORDA}` },
  }, [
    el('div', { style: { display: 'flex', fontSize: '22px', fontWeight: 700, color: COR_TEXTO } }, [`Orçamento ${numero}`]),
  ]);
}

function blocoCliente(orc: OrcamentoRow, cliente: ClienteRow | null): Node {
  const linhas = linhasCliente(cliente, orc.cliente_nome);
  return el('div', {
    style: { display: 'flex', flexDirection: 'row', marginBottom: '16px', gap: '12px' },
  }, [
    el('div', { style: { display: 'flex', flexDirection: 'column', flex: 1 } }, [
      el('div', { style: { display: 'flex', fontWeight: 700, fontSize: '13px', borderBottom: `1px solid ${COR_BORDA}`, paddingBottom: '4px', marginBottom: '6px' } }, ['Cliente']),
      ...linhas.map((l, i) => el('div', { style: { display: 'flex', fontSize: '12px', fontWeight: i === 0 ? 700 : 400, marginBottom: '2px' } }, [l])),
    ]),
    el('div', { style: { display: 'flex', flexDirection: 'column', width: '280px' } }, [
      tabelaInfo([
        ['Número do pedido', orc.numero],
        ['Data', fmtData(orc.criado_em)],
        ['Data prevista', ''],
      ]),
    ]),
  ]);
}

function tabelaInfo(rows: Array<[string, string]>): Node {
  return el('div', { style: { display: 'flex', flexDirection: 'column' } },
    rows.map(([k, v]) =>
      el('div', { style: { display: 'flex', flexDirection: 'row', border: `1px solid ${COR_BORDA}`, borderTopWidth: '0px' } }, [
        el('div', { style: { display: 'flex', width: '140px', padding: '6px 8px', fontSize: '11px', color: COR_SECUNDARIA, borderRight: `1px solid ${COR_BORDA}` } }, [k]),
        el('div', { style: { display: 'flex', flex: 1, padding: '6px 8px', fontSize: '12px', fontWeight: 700 } }, [v]),
      ])
    ).map((n, i, arr) => {
      // Adiciona borda superior na primeira linha
      if (i === 0 && n && typeof n === 'object') {
        (n.props.style as any).borderTopWidth = '1px';
      }
      return n;
    })
  );
}

function blocoVendedor(vendedor: string): Node {
  return el('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: '16px' } }, [
    el('div', { style: { display: 'flex', fontWeight: 700, fontSize: '13px', borderBottom: `1px solid ${COR_BORDA}`, paddingBottom: '4px', marginBottom: '6px' } }, ['Vendedor']),
    el('div', { style: { display: 'flex', fontSize: '12px' } }, [vendedor.toUpperCase()]),
  ]);
}

function blocoTotais(orc: OrcamentoRow): Node {
  const itens = Array.isArray(orc.itens) ? orc.itens : [];
  let qtdTotal = 0;
  let valorTotal = 0;
  for (const it of itens) {
    qtdTotal += Number(it.qtd || 0);
    const subtotal = Number(it.subtotal != null ? it.subtotal : Number(it.qtd || 0) * Number(it.preco_unit || 0));
    valorTotal += subtotal;
  }
  const totais: Array<[string, string, boolean]> = [
    ['N° de itens', fmtBR(itens.length, 0), false],
    ['Soma das Qtdes', fmtBR(qtdTotal), false],
    ['Total de produtos', fmtBR(valorTotal), true],
    ['Total do pedido', fmtBR(Number(orc.total)), true],
  ];
  return el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: '12px' } },
    totais.map(([k, v, bold]) =>
      el('div', { style: { display: 'flex', flexDirection: 'row', border: `1px solid ${COR_BORDA}`, borderTopWidth: '0px' } }, [
        el('div', { style: { display: 'flex', flex: 1, padding: '6px 10px', fontSize: '12px', fontWeight: bold ? 700 : 400, justifyContent: 'flex-end', borderRight: `1px solid ${COR_BORDA}` } }, [k]),
        el('div', { style: { display: 'flex', width: '180px', padding: '6px 10px', fontSize: '12px', fontWeight: bold ? 700 : 400, justifyContent: 'flex-end' } }, [v]),
      ])
    ).map((n, i) => {
      if (i === 0 && n && typeof n === 'object') {
        (n.props.style as any).borderTopWidth = '1px';
      }
      return n;
    })
  );
}

function blocoObservacoes(): Node {
  return el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: '20px' } }, [
    el('div', { style: { display: 'flex', fontWeight: 700, fontSize: '13px', marginBottom: '4px' } }, ['Observações']),
    el('div', { style: { display: 'flex', border: `1px solid ${COR_BORDA}`, height: '70px' } }, []),
  ]);
}

function rodape(numero: string, paginaAtual: number, totalPaginas: number): Node {
  return el('div', { style: { display: 'flex', flexDirection: 'row', marginTop: '16px', paddingTop: '8px', borderTop: `1px solid ${COR_BORDA}`, fontSize: '10px', color: COR_SECUNDARIA } }, [
    el('div', { style: { display: 'flex', flex: 1 } }, [`WIN Distribuidora — Orçamento ${numero}`]),
    el('div', { style: { display: 'flex' } }, [`Página ${paginaAtual} de ${totalPaginas}`]),
  ]);
}

function cabecalhoFino(): Node {
  return el('div', { style: { display: 'flex', flexDirection: 'row', fontSize: '10px', color: COR_SECUNDARIA, marginBottom: '8px' } }, [
    el('div', { style: { display: 'flex', flex: 1 } }, ['WIN Distribuidora — Orçamento']),
    el('div', { style: { display: 'flex' } }, [fmtData(new Date(), true)]),
  ]);
}

// ── Página completa (primeira) ─────────────────────────────────────────────
function montarPaginaPrimeira(orc: OrcamentoRow, cliente: ClienteRow | null, itensPagina: any[], paginaAtual: number, totalPaginas: number, incluiTotais: boolean): Node {
  const itensNodes = itensPagina.map(tabelaRow);
  const filhos: Node[] = [
    cabecalhoFino(),
    blocoCabecalhoEmpresa(),
    blocoTitulo(orc.numero),
    blocoCliente(orc, cliente),
    blocoVendedor(orc.vendedor_nome || '—'),
    el('div', { style: { display: 'flex', fontWeight: 700, fontSize: '13px', marginBottom: '6px' } }, ['Itens do pedido de venda']),
    tabelaHeader(),
    ...itensNodes,
  ];
  if (incluiTotais) {
    filhos.push(blocoTotais(orc));
    filhos.push(blocoObservacoes());
  }
  filhos.push(rodape(orc.numero, paginaAtual, totalPaginas));
  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: '32px 40px',
      backgroundColor: '#ffffff',
      fontFamily: 'Inter',
    },
  }, filhos);
}

// ── Página continuação ─────────────────────────────────────────────────────
function montarPaginaContinuacao(orc: OrcamentoRow, itensPagina: any[], paginaAtual: number, totalPaginas: number, incluiTotais: boolean): Node {
  const filhos: Node[] = [
    cabecalhoFino(),
    el('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginBottom: '12px' } }, [
      el('div', { style: { display: 'flex', fontSize: '14px', fontWeight: 700 } }, [`Orçamento ${orc.numero} — continuação`]),
      el('div', { style: { display: 'flex', fontSize: '12px', color: COR_SECUNDARIA } }, [orc.cliente_nome || '']),
    ]),
    tabelaHeader(),
    ...itensPagina.map(tabelaRow),
  ];
  if (incluiTotais) {
    filhos.push(blocoTotais(orc));
    filhos.push(blocoObservacoes());
  }
  filhos.push(rodape(orc.numero, paginaAtual, totalPaginas));
  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: '32px 40px',
      backgroundColor: '#ffffff',
      fontFamily: 'Inter',
    },
  }, filhos);
}

// ── Renderização ───────────────────────────────────────────────────────────
async function renderNode(node: Node): Promise<Buffer> {
  const { regular, bold } = loadFonts();
  const svg = await satori(node as any, {
    width: W,
    fonts: [
      { name: 'Inter', data: regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  return Buffer.from(png);
}

// ── API pública ────────────────────────────────────────────────────────────
export async function generateOrcamentoImages(numero: string, opts?: { vendedorIdScope?: string }): Promise<Buffer[]> {
  const params: any[] = [numero];
  let extraWhere = '';
  if (opts?.vendedorIdScope) {
    params.push(opts.vendedorIdScope);
    extraWhere = ' AND o.vendedor_id = $2';
  }
  const { rows } = await pool.query(
    `SELECT o.numero, o.cliente_id, o.cliente_nome, o.itens, o.total,
            o.criado_em, o.status, v.nome AS vendedor_nome
     FROM orcamentos o
     LEFT JOIN vendedores v ON v.id = o.vendedor_id
     WHERE o.numero = $1${extraWhere}`,
    params
  );
  if (rows.length === 0) {
    const err: any = new Error('Orçamento não encontrado');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const orc = rows[0] as OrcamentoRow;

  let cliente: ClienteRow | null = null;
  if (orc.cliente_id) {
    const c = await pool.query(
      `SELECT nome, fantasia, tipo_pessoa, cpf_cnpj, ie_rg,
              endereco, numero, complemento, bairro, cep, cidade, uf,
              fone, celular, email
       FROM clientes WHERE id = $1`,
      [orc.cliente_id]
    );
    if (c.rows.length > 0) cliente = c.rows[0];
  }

  return renderOrcamentoImages(orc, cliente);
}

export async function renderOrcamentoImages(orc: OrcamentoRow, cliente: ClienteRow | null): Promise<Buffer[]> {
  const itens = Array.isArray(orc.itens) ? orc.itens : [];

  // Particiona itens em páginas
  const paginas: any[][] = [];
  if (itens.length === 0) {
    paginas.push([]);
  } else {
    paginas.push(itens.slice(0, ITEMS_PER_FIRST_PAGE));
    let idx = ITEMS_PER_FIRST_PAGE;
    while (idx < itens.length) {
      paginas.push(itens.slice(idx, idx + ITEMS_PER_NEXT_PAGE));
      idx += ITEMS_PER_NEXT_PAGE;
    }
  }

  const totalPaginas = paginas.length;
  const buffers: Buffer[] = [];

  for (let i = 0; i < paginas.length; i++) {
    const isUltima = i === paginas.length - 1;
    const node = i === 0
      ? montarPaginaPrimeira(orc, cliente, paginas[i], i + 1, totalPaginas, isUltima)
      : montarPaginaContinuacao(orc, paginas[i], i + 1, totalPaginas, isUltima);
    buffers.push(await renderNode(node));
  }

  return buffers;
}
