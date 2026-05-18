import PDFDocument from 'pdfkit';
import { pool } from '../db/pool.js';

// Layout descrito em docs/PDF_ORCAMENTO.md. PDFKit, A4, fontes nativas (Helvetica).
// Geração inteiramente no backend; retorna Buffer pronto pra resposta HTTP ou
// anexo via Evolution (Fase 4, item 5.1).

// Dados da WIN — fixos no PDF. Se passarem a variar, mover para system_config.
const EMPRESA = {
  razao: 'E S L S LTDA',
  fone: '(86) 99568-3559',
  endereco: 'Rua Waldemar Rocha, N° 3213',
  cidade: '64078640 - Teresina, PI',
  cnpj: 'CNPJ: 57.355.738/0001-99',
  ie: 'IE: 197705260',
};

const COR_PRIMARIA = '#1a3a8a';
const COR_LINHA = '#bfbfbf';
const COR_SECUNDARIA = '#666666';

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

// Linha cliente formatada conforme template (linhas com campos opcionais omitidos).
function linhasCliente(c: ClienteRow | null, fallbackNome: string | null): string[] {
  if (!c) {
    return fallbackNome ? [fallbackNome] : ['Cliente não identificado'];
  }
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

  const linhaEndereco: string[] = [];
  if (c.endereco) {
    let l = c.endereco;
    if (c.numero) l += `, N° ${c.numero}`;
    if (c.complemento) l += `, ${c.complemento}`;
    if (c.bairro) l += `, Bairro: ${c.bairro}`;
    linhaEndereco.push(l);
  }
  if (linhaEndereco.length) out.push(linhaEndereco[0]);

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

export async function generateOrcamentoPDF(numero: string, opts?: { vendedorIdScope?: string }): Promise<Buffer> {
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

  return renderOrcamentoPDF(orc, cliente);
}

export function renderOrcamentoPDF(orc: OrcamentoRow, cliente: ClienteRow | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const M = doc.page.margins.left;
    const right = W - doc.page.margins.right;
    const usable = right - M;

    // ── 1. Cabeçalho fino ────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(COR_SECUNDARIA).font('Helvetica');
    doc.text('WIN Distribuidora — Orçamento', M, 28, { width: usable / 2 });
    doc.text(fmtData(new Date(), true), M + usable / 2, 28, { width: usable / 2, align: 'right' });
    doc.fillColor('black');

    // ── 2. Bloco empresa (logo + dados) ──────────────────────────────────────
    const topoEmpresa = 50;
    // Logo retangular WIN
    doc.roundedRect(M, topoEmpresa, 90, 50, 4).fill(COR_PRIMARIA);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(11);
    doc.text('WIN', M, topoEmpresa + 10, { width: 90, align: 'center' });
    doc.fontSize(7).text('DISTRIBUIDORA', M, topoEmpresa + 28, { width: 90, align: 'center' });

    // Dados da empresa (right-aligned)
    doc.fillColor('black').font('Helvetica').fontSize(9);
    const dadosEmp = [
      `${EMPRESA.razao} - ${EMPRESA.fone}`,
      EMPRESA.endereco,
      EMPRESA.cidade,
      `${EMPRESA.cnpj}, ${EMPRESA.ie}`,
    ];
    let y = topoEmpresa;
    for (const linha of dadosEmp) {
      doc.text(linha, M, y, { width: usable, align: 'right' });
      y += 11;
    }

    // ── 3. Título do documento ───────────────────────────────────────────────
    doc.moveTo(M + 80, 120).lineTo(right - 80, 120).strokeColor(COR_LINHA).stroke();
    doc.fillColor('black').font('Helvetica-Bold').fontSize(16);
    doc.text(`Orçamento ${orc.numero}`, M, 130, { width: usable, align: 'center' });
    doc.moveTo(M + 80, 155).lineTo(right - 80, 155).strokeColor(COR_LINHA).stroke();

    // ── 4. Cliente (esquerda) + Numero/Data (direita) ────────────────────────
    const topoBloco = 170;
    const colEsqW = usable * 0.62;
    const colDirX = M + colEsqW + 10;
    const colDirW = usable - colEsqW - 10;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text('Cliente', M, topoBloco);
    doc.moveTo(M, topoBloco + 14).lineTo(M + colEsqW, topoBloco + 14).strokeColor(COR_LINHA).stroke();

    doc.font('Helvetica').fontSize(9);
    let yc = topoBloco + 20;
    const linhas = linhasCliente(cliente, orc.cliente_nome);
    linhas.forEach((l, idx) => {
      if (idx === 0) doc.font('Helvetica-Bold');
      else doc.font('Helvetica');
      doc.text(l, M, yc, { width: colEsqW });
      yc += 12;
    });

    // Tabela número/data
    const linhasInfo: Array<[string, string]> = [
      ['Número do pedido', orc.numero],
      ['Data', fmtData(orc.criado_em)],
      ['Data prevista', ''],
    ];
    let yInfo = topoBloco;
    const labelW = colDirW * 0.55;
    for (const [k, v] of linhasInfo) {
      doc.rect(colDirX, yInfo, labelW, 18).strokeColor(COR_LINHA).stroke();
      doc.rect(colDirX + labelW, yInfo, colDirW - labelW, 18).stroke();
      doc.font('Helvetica').fontSize(8).fillColor(COR_SECUNDARIA);
      doc.text(k, colDirX + 4, yInfo + 5, { width: labelW - 8 });
      doc.font('Helvetica-Bold').fontSize(9).fillColor('black');
      doc.text(v, colDirX + labelW + 4, yInfo + 4, { width: colDirW - labelW - 8 });
      yInfo += 18;
    }

    const fimCliente = Math.max(yc, yInfo) + 10;

    // ── 5. Vendedor ──────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text('Vendedor', M, fimCliente);
    doc.moveTo(M, fimCliente + 14).lineTo(M + colEsqW, fimCliente + 14).strokeColor(COR_LINHA).stroke();
    doc.font('Helvetica').fontSize(9).fillColor('black');
    doc.text((orc.vendedor_nome || '—').toUpperCase(), M, fimCliente + 20, { width: colEsqW });

    // ── 6. Tabela de itens ───────────────────────────────────────────────────
    const topoItens = fimCliente + 45;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text('Itens do pedido de venda', M, topoItens);

    // Colunas: descrição | código | un. | qtd | valor unit | valor total
    const cols = [
      { label: 'Descrição do produto/serviço', w: usable * 0.43, align: 'left' as const },
      { label: 'Código', w: usable * 0.10, align: 'left' as const },
      { label: 'Un.', w: usable * 0.06, align: 'center' as const },
      { label: 'Qtd.', w: usable * 0.09, align: 'right' as const },
      { label: 'Valor unit.', w: usable * 0.15, align: 'right' as const },
      { label: 'Valor total', w: usable * 0.17, align: 'right' as const },
    ];
    let yHead = topoItens + 18;
    let xCol = M;
    doc.rect(M, yHead, usable, 20).fillAndStroke('#f1f1f1', COR_LINHA);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
    for (const c of cols) {
      doc.text(c.label, xCol + 4, yHead + 6, { width: c.w - 8, align: c.align });
      xCol += c.w;
    }

    let yRow = yHead + 20;
    let qtdTotal = 0;
    let valorTotal = 0;
    const itens = Array.isArray(orc.itens) ? orc.itens : [];

    doc.font('Helvetica').fontSize(9);

    for (const it of itens) {
      const descricao = String(it.descricao || '');
      const marca = it.marca ? String(it.marca) : '';
      const codigo = it.codigo != null ? String(it.codigo) : (it.product_id != null ? String(it.product_id) : '');
      const un = it.un || 'UN';
      const qtd = Number(it.qtd || 0);
      const precoUnit = Number(it.preco_unit || 0);
      const subtotal = Number(it.subtotal != null ? it.subtotal : qtd * precoUnit);
      qtdTotal += qtd;
      valorTotal += subtotal;

      const tituloLinha = marca && !descricao.toUpperCase().includes(marca.toUpperCase())
        ? `${descricao} - ${marca}`
        : descricao;

      const heightDesc = doc.heightOfString(tituloLinha, { width: cols[0].w - 8 });
      const rowH = Math.max(heightDesc + 8, 22);

      // Quebra de página
      if (yRow + rowH > doc.page.height - 110) {
        doc.addPage();
        yRow = doc.page.margins.top;
      }

      doc.rect(M, yRow, usable, rowH).strokeColor(COR_LINHA).stroke();
      let xC = M;
      const valores = [
        { txt: tituloLinha, w: cols[0].w, align: cols[0].align },
        { txt: codigo, w: cols[1].w, align: cols[1].align },
        { txt: un, w: cols[2].w, align: cols[2].align },
        { txt: fmtBR(qtd), w: cols[3].w, align: cols[3].align },
        { txt: fmtBR(precoUnit), w: cols[4].w, align: cols[4].align },
        { txt: fmtBR(subtotal), w: cols[5].w, align: cols[5].align },
      ];
      doc.fillColor('black').font('Helvetica').fontSize(9);
      for (const v of valores) {
        doc.text(v.txt, xC + 4, yRow + 4, { width: v.w - 8, align: v.align });
        xC += v.w;
      }
      yRow += rowH;
    }

    // ── 7. Totais ────────────────────────────────────────────────────────────
    const totalLabelW = usable * 0.62;
    const totalValueW = usable - totalLabelW;
    const totais: Array<[string, string]> = [
      ['N° de itens', fmtBR(itens.length)],
      ['Soma das Qtdes', fmtBR(qtdTotal)],
      ['Total de produtos', fmtBR(valorTotal)],
      ['Total do pedido', fmtBR(Number(orc.total))],
    ];
    if (yRow + totais.length * 16 + 40 > doc.page.height - 60) {
      doc.addPage();
      yRow = doc.page.margins.top;
    }
    for (let i = 0; i < totais.length; i++) {
      const [k, v] = totais[i];
      const bold = i >= 2;
      doc.rect(M, yRow, totalLabelW, 16).strokeColor(COR_LINHA).stroke();
      doc.rect(M + totalLabelW, yRow, totalValueW, 16).stroke();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('black');
      doc.text(k, M + 4, yRow + 4, { width: totalLabelW - 8, align: 'right' });
      doc.text(v, M + totalLabelW + 4, yRow + 4, { width: totalValueW - 8, align: 'right' });
      yRow += 16;
    }

    // ── 8. Observações ───────────────────────────────────────────────────────
    yRow += 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text('Observações', M, yRow);
    doc.rect(M, yRow + 14, usable, 50).strokeColor(COR_LINHA).stroke();

    // ── 9. Rodapé fino em cada página ────────────────────────────────────────
    // O rodapé precisa ficar DENTRO da área útil (acima de page.height -
    // margins.bottom), senão o LineWrapper do PDFKit empurra para uma nova
    // página automaticamente, mesmo com lineBreak: false.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const rodape = doc.page.height - doc.page.margins.bottom - 12;
      doc.fontSize(8).fillColor(COR_SECUNDARIA).font('Helvetica');
      doc.text('WIN Distribuidora', M, rodape, { width: usable / 2, lineBreak: false });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, M + usable / 2, rodape, {
        width: usable / 2,
        align: 'right',
        lineBreak: false,
      });
    }

    doc.end();
  });
}
