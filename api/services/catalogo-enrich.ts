// Enriquecimento determinístico de produtos para o catálogo.
//
// Tudo aqui é função PURA da descrição: limpa o texto (mojibake), e extrai
// marca / nome-base / variação (sabor, cor, tamanho) / chave de agrupamento.
// Como é derivado, é recalculado a cada upload de estoque — não precisa ser
// preservado no re-import (ao contrário de `categoria`, que é curada à mão).
//
// O agrupamento de variações existe SÓ para a vitrine pública: o sistema dos
// vendedores e os orçamentos continuam operando 1 SKU por sabor.

// --- Conserto de mojibake (UTF-8 redecodificado como Windows-1252) ---
//
// Os produtos foram importados com o texto UTF-8 reinterpretado byte-a-byte como
// cp1252, gerando sequências como "PAÃ‡OCA" (deveria ser "PAÇOCA"). Para reverter,
// re-encodamos a string de volta para os bytes cp1252 e reinterpretamos como UTF-8.
// O truque está na faixa 0x80–0x9F, que no cp1252 difere do Latin-1 — sem este
// mapa o conserto erra (ex.: "Ãƒ" viraria "Ò" em vez de "Ã").
const CP1252_REV = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

// Uma passada de conserto. Retorna null quando a string contém algum caractere
// que o cp1252 não representa (sinal de que NÃO é mojibake desse tipo) ou quando
// a reinterpretação UTF-8 gera o caractere de substituição (�).
function consertarUmaVez(s: string): string | null {
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_REV.has(cp)) bytes.push(CP1252_REV.get(cp)!);
    else return null;
  }
  const out = Buffer.from(bytes).toString('utf8');
  if (out.includes('�')) return null;
  return out;
}

// Marcadores clássicos de mojibake (acentos UTF-8 lidos como 1252 viram 'Ã'/'Â'
// seguidos de algo, ou aparecem caracteres especiais do cp1252 fora de contexto).
const MOJIBAKE_RE = /[ÃÂ][-¿ŒœŠšŽžŸƒˆ˜–-™]|[ŒœŠšŽžƒ–—‘-„†-•…‰‹›€™]/;

function contaMarcadores(s: string): number {
  const m = s.match(/[ÃÂŒœŠšŽžƒ–-™]/g);
  return m ? m.length : 0;
}

// Limpa o texto: conserta mojibake (inclusive duplo) e normaliza espaços
// (NBSP → espaço, colapsa múltiplos, trim). Idempotente: limpar texto já limpo
// não muda nada.
export function limparTexto(s: string | null | undefined): string {
  if (s == null) return '';
  let cur = String(s);
  // Mojibake pode estar em camadas (dupla codificação) — repara enquanto melhora.
  for (let i = 0; i < 3; i++) {
    if (!MOJIBAKE_RE.test(cur)) break;
    const next = consertarUmaVez(cur);
    if (next == null || next === cur) break;
    if (contaMarcadores(next) >= contaMarcadores(cur)) break; // só aceita se reduziu
    cur = next;
  }
  return cur.replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

// --- Parsing da descrição ---

// Remove acentos para a chave de agrupamento (unaccent + caixa-alta).
function dobrarAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizarChave(s: string): string {
  return dobrarAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

export type VariacaoTipo = 'sabor' | 'cor_tamanho' | null;

export interface ProdutoParse {
  nomeBase: string;       // título do card (sem marca nem variação)
  marca: string | null;   // extraída do trecho após o último " - "
  variacaoTipo: VariacaoTipo;
  variacao: string | null; // valor da variação (ex.: "CHOCOLATE BRANCO", "PRETA · G")
  grupoChave: string;     // chave normalizada que agrupa as variações de um mesmo produto
}

// Primeiro marcador de variação na descrição (SABOR/COR/TAMANHO precedido de espaço).
const MARCADOR_VARIACAO = /\s(SABOR|COR|TAMANHO):/i;

// Extrai marca a partir do trecho "base+marca": a marca é o que vem depois do
// ÚLTIMO " - " (espaço-hífen-espaço). Sem esse separador, marca = null (casos a
// curar na tela de revisão: ~17 produtos sem hífen).
function separarMarca(baseMarca: string): { nomeBase: string; marca: string | null } {
  const sep = ' - ';
  const idx = baseMarca.lastIndexOf(sep);
  if (idx === -1) return { nomeBase: baseMarca.trim(), marca: null };
  const nomeBase = baseMarca.slice(0, idx).trim();
  const marca = baseMarca.slice(idx + sep.length).trim();
  return { nomeBase: nomeBase || baseMarca.trim(), marca: marca || null };
}

// Interpreta o trecho de variação ("SABOR:X", "COR:PRETA;TAMANHO:G", ...).
function parseVariacao(raw: string): { tipo: VariacaoTipo; valor: string | null } {
  const partes = raw.split(';').map((p) => p.trim()).filter(Boolean);
  const valores: string[] = [];
  let soSabor = true;
  for (const parte of partes) {
    const m = parte.match(/^(SABOR|COR|TAMANHO):\s*(.*)$/i);
    if (!m) {
      valores.push(parte);
      continue;
    }
    if (m[1].toUpperCase() !== 'SABOR') soSabor = false;
    if (m[2].trim()) valores.push(m[2].trim());
  }
  if (valores.length === 0) return { tipo: null, valor: null };
  return { tipo: soSabor ? 'sabor' : 'cor_tamanho', valor: valores.join(' · ') };
}

// Recebe a descrição JÁ LIMPA (passe por limparTexto antes).
export function parseDescricao(descricaoLimpa: string): ProdutoParse {
  const desc = (descricaoLimpa ?? '').trim();
  const m = desc.match(MARCADOR_VARIACAO);

  let baseMarca = desc;
  let variacaoTipo: VariacaoTipo = null;
  let variacao: string | null = null;

  if (m && m.index !== undefined) {
    baseMarca = desc.slice(0, m.index).trim();
    const raw = desc.slice(m.index + 1).trim(); // remove o espaço inicial do marcador
    const v = parseVariacao(raw);
    variacaoTipo = v.tipo;
    variacao = v.valor;
  }

  const { nomeBase, marca } = separarMarca(baseMarca);
  const grupoChave = normalizarChave(baseMarca);

  return { nomeBase, marca, variacaoTipo, variacao, grupoChave };
}

// --- Classificação de categorias ---

export interface Categoria {
  slug: string;
  label: string;
}

// Taxonomia do catálogo. `outros` é o fallback (e o balde que a tela de revisão
// prioriza). A ordem aqui também é a ordem de exibição dos filtros na vitrine.
export const CATEGORIAS: Categoria[] = [
  { slug: 'proteinas', label: 'Proteínas' },
  { slug: 'creatina', label: 'Creatina' },
  { slug: 'pre-treino', label: 'Pré-treino' },
  { slug: 'aminoacidos', label: 'Aminoácidos' },
  { slug: 'termogenicos', label: 'Termogênicos' },
  { slug: 'hipercaloricos', label: 'Hipercalóricos' },
  { slug: 'pasta-amendoim', label: 'Pasta de Amendoim' },
  { slug: 'barras-snacks', label: 'Barras & Snacks' },
  { slug: 'bebidas-geis', label: 'Bebidas & Géis' },
  { slug: 'colageno', label: 'Colágeno' },
  { slug: 'vitaminas-saude', label: 'Vitaminas & Saúde' },
  { slug: 'beleza-cabelo', label: 'Beleza & Cabelo' },
  { slug: 'alimentos', label: 'Alimentos Saudáveis' },
  { slug: 'acessorios', label: 'Acessórios' },
  { slug: 'vestuario', label: 'Vestuário' },
  { slug: 'outros', label: 'Outros' },
];

const SLUGS_VALIDOS = new Set(CATEGORIAS.map((c) => c.slug));
export function categoriaValida(slug: string | null | undefined): boolean {
  return slug != null && SLUGS_VALIDOS.has(slug);
}

// Regras ordenadas por especificidade — a PRIMEIRA que casar vence. Cada regra
// testa o texto já normalizado (sem acento, minúsculo). A ordem importa: o que é
// "barra de whey" tem que ser pego como snack ANTES da regra de proteína; comida
// e cosmético vêm antes do balde grande de vitaminas/saúde.
// Fronteira só à ESQUERDA (\b ... sem \b final) para casar plurais/sufixos
// (cookies, magnesios, artroax). Mais permissivo de propósito; a tela de revisão
// corrige os poucos falsos positivos. Pré-treinos são quase todos nome de marca
// (whack-a-mole) — listo os conhecidos e o resto fica para revisão.
const REGRAS: Array<{ slug: string; re: RegExp }> = [
  { slug: 'vestuario', re: /\b(camiseta|camisa|regata|bermuda|short|calca|moletom|blusa|babylook|legging|bone|meia|jaqueta|sunga|cropped|top fitness|dry fit|dry max)/ },
  { slug: 'acessorios', re: /\b(coqueteleira|shaker|squeeze|garrafa|galao|copo|caneca|necessaire|toalha|bolsa|mochila|luva|balanca|dosador|porta.?caps|porta.?capsula|strap|cinto|joelheira|munhequeira|colher dosadora|boneco|action figure)/ },
  { slug: 'beleza-cabelo', re: /\b(shampoo|condicionador|leave.?in|hidratante|mascara|mosqueta|antiqueda|sabonete|serum|maquiagem|batom|protetor solar|pracaxi|argan|creme facial)/ },
  { slug: 'pasta-amendoim', re: /\bpasta de amendoim|\bpasta amendoim/ },
  { slug: 'colageno', re: /\b(colagen|collagen|verisol|hialuron)/ },
  { slug: 'creatina', re: /\b(creatin|creatine|creapure|createst)/ },
  { slug: 'barras-snacks', re: /\b(barra|wafer|biscoito|cookie|alfajor|chips|crocante|snack|bombom|tablete|crunch|wrap|pao de mel|bocadito|cubos de frutas|bolinho|crisp)|\bbar\b|\bchocolate (zero|proteico|ao leite|amargo|branco|70|noir)|\bprotein bar|\bwhey bar/ },
  { slug: 'pre-treino', re: /\bpre.?treino|\bpre.?workout|\b(warzone|maquiavel|pre combat|armagedom|silverback|nuclear rush|psycho|haze|insanity|gorilla|horus|diabo verde|bone crusher|evora xt|2 hot|venom|sicarius|vasodilatador|prime md|panic|theca|agent orange|b\.o\.p\.e|bope|appogeu|abissal|betapure|clembuter|midnight|hot blood|c4|the chosen one|pump|nitrato|dila|egide|dimethyl|eagle extreme)/ },
  { slug: 'termogenicos', re: /\btermog|\bthermo|\blipo\b|\b(oxyelite|carnitina|l.?carnitin|cafeina|caffeine|cutter|definamax|emagrec)/ },
  { slug: 'aminoacidos', re: /\b(bcaa|glutamin|leucin|beta.?alanin|arginin|citrulin|taurin|amino|eaa|hmb|aakg)/ },
  { slug: 'hipercaloricos', re: /\b(hipercalor|gainer|massa|masstodon|creamass|bulk)/ },
  { slug: 'proteinas', re: /\b(whey|albumin|casein|isolad|concentrad|protein|beef|egg pro|3whey|wpc|wpi|isofort|cleanpro|hidrolisad|carnibol|best vegan|diet shake)/ },
  { slug: 'bebidas-geis', re: /\b(drink|isotonic|energy|energetico|repositor|hydrolite|hidro gel|agua|suco|refrig|bebida|shot|tonica|kombucha|energy gel|nitro power gel)|\bgel\b|\bcha\b/ },
  { slug: 'alimentos', re: /\b(aveia|granola|adocante|stevia|melado|acucar|xilitol|eritritol|macarrao|farinha|tapioca|fecula|azeite|oleo de coco|salgante|geleia|molho|sopa|caldo|calda|cacau|leite de coco|leite em po|pipoca|castanha|chia|linhaca|quinoa|cuscuz|pao de queijo|creme de avela|creme de amendoim|barbecue|cheddar|ranch|maionese|ketchup|mostarda|cobertura|burguer|hamburguer|canja|creme de cebola|creme de pimenta|creme proteico|mrs taste|mexidona)|\bmel\b/ },
  { slug: 'vitaminas-saude', re: /\b(vitamin|vita|omega|magnesio|zinco|multivit|complexo|coenzima|q10|melatonin|d3|b12|cranberry|propolis|curcuma|chlorella|spirulina|biotina|inositol|colina|picolinat|cromo|chromium|cromium|nac|berinjela|quitosana|condroitina|glucosamina|artro|ginkgo|valeriana|passiflora|triptofano|maca peruana|long jack|tribulus|boro|prostat|imune|imuni|fibra|psyllium|probiotico|prebiotico|simfort|potassio|cloreto|treonat|dha|epa|luteina|resveratrol|silimarina|moringa|alho|primula|borragem|cartamo|zma|sleep|hair|prata coloidal|tadapower|iopower|duratest|vasoflex|vasculor|dimaplus|unimag|nutri complex|acetilcistein|agar|amora|cartilagem|caibroff|bio femme|acerola|magnesi|curcumin|calcio|daily formula|animal pak|chol control)/ },
];

// Classifica a partir do texto JÁ LIMPO (descrição completa). Devolve sempre um
// slug válido (cai em 'outros' quando nada casa).
export function classificarCategoria(descricaoLimpa: string): string {
  const t = normalizarChave(descricaoLimpa).toLowerCase();
  for (const { slug, re } of REGRAS) {
    if (re.test(t)) return slug;
  }
  return 'outros';
}
