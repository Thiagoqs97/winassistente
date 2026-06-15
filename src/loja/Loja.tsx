import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { apiFetch, ApiError } from '../lib/api';

interface Variacao {
  id: number;
  variacao: string | null;
  preco: number;
  imagem_url: string | null;
}

interface Grupo {
  grupoChave: string;
  nomeBase: string;
  marca: string | null;
  categoria: string | null;
  variacaoTipo: string | null; // 'sabor' | 'cor_tamanho' | null
  imagem: string | null;
  precoMin: number;
  precoMax: number;
  totalVariacoes: number;
  variacoes: Variacao[];
}

interface ItemCarrinho {
  id: number;
  nomeBase: string;
  marca: string | null;
  variacao: string | null;
  preco: number;
  imagem: string | null;
  qtd: number;
}

interface Categoria { slug: string; label: string; total: number }
interface Marca { marca: string; total: number }

interface ResultadoPedido {
  numero: string;
  total: number;
  itens: { descricao: string; marca: string | null; qtd: number; preco_unit: number; subtotal: number }[];
  clienteNome: string;
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const LIMITE = 24;

// Paleta WIN (da logo: navy + dourado). Botão dourado com leve gradiente.
const BTN_OURO =
  'bg-gradient-to-b from-[#f0c44a] to-[#d9a52e] hover:from-[#f5cd5f] hover:to-[#c8941f] text-[#16223f]';

// Rótulo do seletor conforme o tipo de variação.
const rotuloVariacao = (tipo: string | null) =>
  tipo === 'cor_tamanho' ? 'Opção' : 'Sabor';

// Plural do contador de variações no badge do card.
const rotuloVariacoes = (tipo: string | null) =>
  tipo === 'cor_tamanho' ? 'opções' : 'sabores';

// Ícone por categoria (slug da taxonomia em catalogo-enrich.ts). Usado nos
// tiles de "Comprar por categoria".
const ICONE_CATEGORIA: Record<string, string> = {
  proteinas: '💪',
  creatina: '⚡',
  'pre-treino': '🔥',
  aminoacidos: '🧬',
  termogenicos: '♨️',
  hipercaloricos: '🏋️',
  'pasta-amendoim': '🥜',
  'barras-snacks': '🍫',
  'bebidas-geis': '🥤',
  colageno: '✨',
  'vitaminas-saude': '💊',
  'beleza-cabelo': '💇',
  alimentos: '🥗',
  acessorios: '🎽',
  vestuario: '👕',
  outros: '📦',
};

// --- Ilustrações dos banners (SVG flat, two-tone navy+dourado, sem assets) ---

function IlluPote({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} fill="none" aria-hidden>
      <ellipse cx="100" cy="228" rx="62" ry="9" fill="#000" opacity="0.18" />
      <rect x="44" y="74" width="112" height="148" rx="18" fill="#ffffff" fillOpacity="0.1" stroke="#e0b13c" strokeWidth="3.5" />
      <rect x="44" y="122" width="112" height="58" fill="#e0b13c" />
      <path d="M108 130 l-22 30 h14 l-8 24 30 -36 h-15 z" fill="#16223f" />
      <rect x="50" y="44" width="100" height="36" rx="12" fill="#f0c44a" />
      <rect x="62" y="31" width="76" height="20" rx="9" fill="#e0b13c" />
    </svg>
  );
}

function IlluShaker({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} fill="none" aria-hidden>
      <ellipse cx="100" cy="228" rx="50" ry="9" fill="#000" opacity="0.18" />
      <path d="M64 72 h72 v118 a26 26 0 0 1 -26 26 h-20 a26 26 0 0 1 -26 -26 z" fill="#ffffff" fillOpacity="0.1" stroke="#e0b13c" strokeWidth="3.5" />
      <path d="M64 150 h72 v40 a26 26 0 0 1 -26 26 h-20 a26 26 0 0 1 -26 -26 z" fill="#e0b13c" fillOpacity="0.85" />
      <line x1="74" y1="92" x2="92" y2="92" stroke="#e0b13c" strokeWidth="3" strokeLinecap="round" />
      <line x1="74" y1="112" x2="92" y2="112" stroke="#e0b13c" strokeWidth="3" strokeLinecap="round" />
      <line x1="74" y1="132" x2="92" y2="132" stroke="#e0b13c" strokeWidth="3" strokeLinecap="round" />
      <rect x="72" y="36" width="56" height="30" rx="9" fill="#f0c44a" />
      <rect x="84" y="26" width="32" height="16" rx="7" fill="#e0b13c" />
    </svg>
  );
}

function IlluRaio({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} fill="none" aria-hidden>
      <path d="M120 28 L66 132 H100 L82 212 L150 100 H110 Z" fill="#e0b13c" stroke="#f0c44a" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function IlluChama({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 240" className={className} fill="none" aria-hidden>
      <path d="M104 24 c26 44 56 60 56 108 a56 56 0 1 1 -112 0 c0 -30 18 -44 28 -66 c6 26 0 40 14 40 c16 0 12 -52 14 -82 z" fill="#e0b13c" />
      <path d="M104 104 c14 22 24 32 24 54 a24 24 0 1 1 -48 0 c0 -16 12 -26 24 -54 z" fill="#16223f" />
    </svg>
  );
}

interface Banner {
  key: string;
  eyebrow: string;
  titulo: string;
  destaque?: string;
  sub: string;
  cta: string;
  categoria?: string; // undefined = limpa filtros (catálogo inteiro)
  grad: string;       // classes de gradiente Tailwind
  Illu: (p: { className?: string }) => ReactElement;
}

// Banners da hero, montados a partir das linhas reais da loja (suplementos).
// Os que apontam pra uma categoria só aparecem se a categoria tiver produtos
// (filtrado em runtime contra /loja/categorias).
const BANNERS: Banner[] = [
  {
    key: 'marca',
    eyebrow: 'PREÇO DE DISTRIBUIDORA',
    titulo: 'O melhor do seu treino,',
    destaque: 'com a WIN',
    sub: 'Monte seu pedido online e nossa equipe confirma rapidinho pelo WhatsApp.',
    cta: 'Ver catálogo',
    grad: 'from-[#1b2a4e] to-[#16223f]',
    Illu: IlluShaker,
  },
  {
    key: 'proteinas',
    eyebrow: 'LINHA PROTEÍNAS',
    titulo: 'Whey Protein',
    destaque: 'pra ganhar massa',
    sub: 'Isolado, concentrado e hidrolisado das marcas que você confia.',
    cta: 'Ver proteínas',
    categoria: 'proteinas',
    grad: 'from-[#1b2a4e] via-[#26406f] to-[#16223f]',
    Illu: IlluPote,
  },
  {
    key: 'creatina',
    eyebrow: 'FORÇA & PERFORMANCE',
    titulo: 'Creatina',
    destaque: '100% pura',
    sub: 'Mais força, mais volume e melhor recuperação a cada treino.',
    cta: 'Ver creatinas',
    categoria: 'creatina',
    grad: 'from-[#0e2b3e] to-[#0b1b2b]',
    Illu: IlluRaio,
  },
  {
    key: 'pre-treino',
    eyebrow: 'ENERGIA PRA TREINAR PESADO',
    titulo: 'Pré-treino',
    destaque: 'que você sente',
    sub: 'Foco, pump e disposição do primeiro ao último set.',
    cta: 'Ver pré-treinos',
    categoria: 'pre-treino',
    grad: 'from-[#2a1c3c] to-[#181029]',
    Illu: IlluChama,
  },
];

export default function Loja() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [q, setQ] = useState('');
  const [categoria, setCategoria] = useState('');
  const [marca, setMarca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [marcas, setMarcas] = useState<Marca[]>([]);

  // Variação selecionada por card (grupoChave -> id do SKU).
  const [selecionada, setSelecionada] = useState<Record<string, number>>({});

  const [carrinho, setCarrinho] = useState<Record<number, ItemCarrinho>>({});
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [vista, setVista] = useState<'catalogo' | 'checkout' | 'sucesso'>('catalogo');

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroCheckout, setErroCheckout] = useState<string | null>(null);
  const [pedido, setPedido] = useState<ResultadoPedido | null>(null);

  const [heroIndex, setHeroIndex] = useState(0);
  const produtosRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);

  const carregar = useCallback(async (busca: string, cat: string, mar: string, pag: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ pagina: String(pag), limite: String(LIMITE) });
      if (busca.trim()) params.set('q', busca.trim());
      if (cat) params.set('categoria', cat);
      if (mar) params.set('marca', mar);
      const out = await apiFetch<{ itens: Grupo[]; total: number }>(`/api/loja/produtos?${params}`);
      setTotal(out.total);
      setGrupos((prev) => (pag === 1 ? out.itens : [...prev, ...out.itens]));
    } catch (err: any) {
      setErro(err?.message || 'Não consegui carregar os produtos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // Filtros (carrega categorias/marcas uma vez).
  useEffect(() => {
    apiFetch<Categoria[]>('/api/loja/categorias').then(setCategorias).catch(() => {});
    apiFetch<Marca[]>('/api/loja/marcas').then(setMarcas).catch(() => {});
  }, []);

  // Busca/filtro com debounce: volta pra página 1 a cada mudança.
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      carregar(q, categoria, marca, 1);
    }, 300);
    return () => clearTimeout(t);
  }, [q, categoria, marca, carregar]);

  // Banners cujo destino existe na vitrine (o "catálogo inteiro" sempre entra).
  const slugsDisponiveis = useMemo(() => new Set(categorias.map((c) => c.slug)), [categorias]);
  const banners = useMemo(
    () => BANNERS.filter((b) => !b.categoria || slugsDisponiveis.has(b.categoria)),
    [slugsDisponiveis]
  );
  const slideAtual = banners.length ? heroIndex % banners.length : 0;

  // Auto-rotação da hero (pausa quando só tem 1 banner).
  useEffect(() => {
    if (banners.length <= 1) return;
    const t = setInterval(() => setHeroIndex((i) => (i + 1) % banners.length), 5500);
    return () => clearInterval(t);
  }, [banners.length]);

  const proxBanner = () => setHeroIndex((i) => (i + 1) % banners.length);
  const banAnterior = () => setHeroIndex((i) => (i - 1 + banners.length) % banners.length);

  // Aplica um filtro de categoria e rola até a grade de produtos.
  const irParaCategoria = (slug: string) => {
    setQ('');
    setMarca('');
    setCategoria(slug);
    requestAnimationFrame(() =>
      produtosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    );
  };

  const variacaoAtual = (g: Grupo): Variacao => {
    const id = selecionada[g.grupoChave];
    return g.variacoes.find((v) => v.id === id) ?? g.variacoes[0];
  };

  const setQtd = (item: Omit<ItemCarrinho, 'qtd'>, qtd: number) => {
    setCarrinho((prev) => {
      const next = { ...prev };
      if (qtd <= 0) delete next[item.id];
      else next[item.id] = { ...item, qtd };
      return next;
    });
  };

  const itensCarrinho = useMemo(() => Object.values(carrinho), [carrinho]);
  const totalItens = useMemo(() => itensCarrinho.reduce((s, i) => s + i.qtd, 0), [itensCarrinho]);
  const totalCarrinho = useMemo(
    () => itensCarrinho.reduce((s, i) => s + i.preco * i.qtd, 0),
    [itensCarrinho]
  );

  const enviarPedido = async () => {
    setErroCheckout(null);
    if (nome.trim().length < 2) return setErroCheckout('Informe seu nome.');
    if (telefone.replace(/\D/g, '').length < 10) return setErroCheckout('Informe um telefone com DDD.');
    setEnviando(true);
    try {
      const out = await apiFetch<ResultadoPedido>('/api/loja/pedido', {
        method: 'POST',
        body: JSON.stringify({
          nome,
          telefone,
          itens: itensCarrinho.map((i) => ({ produtoId: i.id, qtd: i.qtd })),
        }),
      });
      setPedido(out);
      setCarrinho({});
      setVista('sucesso');
      setCarrinhoAberto(false);
    } catch (err: any) {
      setErroCheckout(err instanceof ApiError ? err.message : 'Não consegui registrar o pedido. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const novoPedido = () => {
    setPedido(null);
    setNome('');
    setTelefone('');
    setVista('catalogo');
    setQ('');
    setCategoria('');
    setMarca('');
    setPagina(1);
    carregar('', '', '', 1);
  };

  const semFiltro = !q && !categoria && !marca;
  const tituloLista = categoria
    ? categorias.find((c) => c.slug === categoria)?.label ?? 'Resultados'
    : q || marca
      ? 'Resultados'
      : 'Nossos produtos';

  if (vista === 'sucesso' && pedido) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 max-w-md w-full p-8 text-center">
          <img src="/logowin.png" alt="WIN Distribuidora" className="h-12 w-12 rounded-lg mx-auto mb-4" />
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mx-auto mb-4">
            ✓
          </div>
          <h1 className="text-xl font-extrabold text-[#1b2a4e]">Pedido recebido!</h1>
          <p className="text-slate-500 mt-2">
            Seu pedido <span className="font-bold text-[#1b2a4e]">{pedido.numero}</span> foi registrado.
            Nossa equipe vai entrar em contato pra confirmar.
          </p>
          <div className="mt-4 text-left bg-slate-50 rounded-xl p-4 text-sm border border-slate-100">
            <div className="flex justify-between font-bold text-[#1b2a4e]">
              <span>Total</span>
              <span>{brl(pedido.total)}</span>
            </div>
            <p className="text-slate-400 mt-1">{pedido.itens.length} item(ns)</p>
          </div>
          <button
            onClick={novoPedido}
            className={`mt-6 w-full ${BTN_OURO} font-bold rounded-xl py-3 transition`}
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Barra utilitária */}
      <div className="bg-[#14203a] text-slate-300 text-[11px] sm:text-xs safe-pt">
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center justify-center sm:justify-between gap-2">
          <span className="font-medium tracking-wide">WIN DISTRIBUIDORA · Catálogo online</span>
          <span className="hidden sm:inline text-slate-400">Monte seu pedido — a equipe confirma com você</span>
        </div>
      </div>

      {/* Header principal */}
      <header className="sticky top-0 z-20 bg-[#1b2a4e] shadow-md border-b border-[#e0b13c]/20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <img
            src="/logowin.png"
            alt="WIN Distribuidora"
            className="order-1 h-11 w-11 rounded-lg ring-1 ring-white/10 shrink-0"
          />
          <form
            onSubmit={(e) => e.preventDefault()}
            className="order-3 basis-full sm:order-2 sm:basis-auto sm:flex-1 relative"
          >
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar produto ou marca..."
              className="w-full rounded-lg border-0 pl-9 pr-4 py-2.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e0b13c]"
            />
          </form>
          <button
            onClick={() => setCarrinhoAberto(true)}
            className={`order-2 sm:order-3 relative rounded-lg ${BTN_OURO} px-4 py-2.5 text-sm font-bold transition shrink-0`}
          >
            🛒 Carrinho
            {totalItens > 0 && (
              <span className="absolute -top-2 -right-2 bg-[#16223f] text-[#e0b13c] text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold ring-2 ring-[#1b2a4e]">
                {totalItens}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Hero — carrossel de banners (auto-rotativo, arrastável) */}
      {banners.length > 0 && (
        <section className="bg-[#16223f]">
          <div className="max-w-6xl mx-auto px-4 pt-4 sm:pt-5">
            <div
              className="relative overflow-hidden rounded-2xl shadow-lg ring-1 ring-white/5"
              onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (touchX.current == null) return;
                const dx = e.changedTouches[0].clientX - touchX.current;
                if (Math.abs(dx) > 40) (dx < 0 ? proxBanner() : banAnterior());
                touchX.current = null;
              }}
            >
              <div
                className="flex transition-transform duration-500 ease-out"
                style={{ transform: `translateX(-${slideAtual * 100}%)` }}
              >
                {banners.map((b) => {
                  const Illu = b.Illu;
                  return (
                    <div
                      key={b.key}
                      className={`relative shrink-0 w-full bg-gradient-to-br ${b.grad}`}
                    >
                      <div className="relative px-5 py-7 sm:px-10 sm:py-12 min-h-[210px] sm:min-h-[280px] flex items-center">
                        {/* Anéis decorativos */}
                        <div className="pointer-events-none absolute -right-16 -top-16 w-56 h-56 rounded-full border border-white/10" />
                        <div className="pointer-events-none absolute right-8 -bottom-24 w-72 h-72 rounded-full border border-white/5" />
                        {/* Ilustração: protagonista no desktop, marca d'água no mobile */}
                        <Illu className="hidden sm:block absolute right-8 bottom-0 h-[250px] w-auto drop-shadow-2xl" />
                        <Illu className="sm:hidden absolute -right-3 bottom-0 h-[150px] w-auto opacity-20" />
                        {/* Texto */}
                        <div className="relative max-w-[80%] sm:max-w-[58%]">
                          <span className="text-[#e0b13c] font-bold tracking-[0.18em] text-[10px] sm:text-xs">
                            {b.eyebrow}
                          </span>
                          <h2 className="mt-1.5 text-white font-extrabold leading-[1.1] text-[22px] sm:text-[34px]">
                            {b.titulo}{' '}
                            {b.destaque && <span className="text-[#e0b13c]">{b.destaque}</span>}
                          </h2>
                          <p className="mt-2 text-slate-300 text-[13px] sm:text-base max-w-md">{b.sub}</p>
                          <button
                            onClick={() => irParaCategoria(b.categoria ?? '')}
                            className={`mt-4 inline-flex items-center gap-2 ${BTN_OURO} rounded-full px-5 py-2.5 text-sm font-bold transition`}
                          >
                            {b.cta} <span aria-hidden>→</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Setas (desktop) */}
              {banners.length > 1 && (
                <>
                  <button
                    onClick={banAnterior}
                    aria-label="Banner anterior"
                    className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/40 text-white items-center justify-center text-xl leading-none transition"
                  >
                    ‹
                  </button>
                  <button
                    onClick={proxBanner}
                    aria-label="Próximo banner"
                    className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/25 hover:bg-black/40 text-white items-center justify-center text-xl leading-none transition"
                  >
                    ›
                  </button>
                  {/* Indicadores */}
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {banners.map((b, i) => (
                      <button
                        key={b.key}
                        onClick={() => setHeroIndex(i)}
                        aria-label={`Ir para o banner ${i + 1}`}
                        className={`h-1.5 rounded-full transition-all ${
                          i === slideAtual ? 'w-5 bg-[#e0b13c]' : 'w-1.5 bg-white/40 hover:bg-white/70'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Comprar por categoria — só na home (sem filtro ativo) */}
      {semFiltro && categorias.length > 0 && (
        <section className="bg-[#16223f]">
          <div className="max-w-6xl mx-auto w-full px-4 pt-6 pb-1">
            <h2 className="text-xs font-extrabold text-[#e0b13c] uppercase tracking-[0.18em] mb-3">
              Comprar por categoria
            </h2>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 sm:gap-3">
              {categorias.slice(0, 8).map((c) => (
                <button
                  key={c.slug}
                  onClick={() => irParaCategoria(c.slug)}
                  className="group flex flex-col items-center gap-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 hover:border-[#e0b13c]/50 p-2.5 sm:p-3 transition"
                >
                  <span className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-gradient-to-br from-[#243a66] to-[#16223f] group-hover:from-[#f0c44a] group-hover:to-[#d9a52e] text-white flex items-center justify-center text-xl shrink-0 ring-1 ring-white/10 transition">
                    {ICONE_CATEGORIA[c.slug] ?? '📦'}
                  </span>
                  <span className="text-[11px] sm:text-xs font-semibold text-slate-200 text-center leading-tight line-clamp-2">
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Filtros: categorias (chips com scroll) + marca (select) */}
      <div className="bg-white border-b border-slate-200 sticky top-[68px] z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <button
              onClick={() => setCategoria('')}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition border ${
                categoria === '' ? 'bg-[#1b2a4e] text-white border-[#1b2a4e]' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-[#1b2a4e]/40'
              }`}
            >
              Todos
            </button>
            {categorias.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCategoria((cur) => (cur === c.slug ? '' : c.slug))}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition border ${
                  categoria === c.slug ? 'bg-[#1b2a4e] text-white border-[#1b2a4e]' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-[#1b2a4e]/40'
                }`}
              >
                {c.label} <span className="opacity-60">{c.total}</span>
              </button>
            ))}
          </div>
          {marcas.length > 0 && (
            <select
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              className="shrink-0 rounded-lg border border-slate-300 text-sm px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e0b13c] max-w-[40vw]"
            >
              <option value="">Todas as marcas</option>
              {marcas.map((m) => (
                <option key={m.marca} value={m.marca}>{m.marca} ({m.total})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 pb-28">
        <div ref={produtosRef} className="scroll-mt-32 flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-extrabold text-[#1b2a4e]">{tituloLista}</h2>
          {total > 0 && <span className="text-xs text-slate-400">{total} itens</span>}
        </div>

        {erro && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm mb-4">{erro}</div>
        )}

        {carregando && grupos.length === 0 ? (
          // Skeleton da primeira carga
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="aspect-square bg-slate-100 animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-1/3 bg-slate-100 rounded animate-pulse" />
                  <div className="h-3 w-3/4 bg-slate-100 rounded animate-pulse" />
                  <div className="h-5 w-1/2 bg-slate-100 rounded animate-pulse" />
                  <div className="h-8 w-full bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : grupos.length === 0 ? (
          <div className="text-center text-slate-400 py-20">
            {semFiltro ? 'Nenhum produto disponível no momento.' : 'Nenhum produto encontrado com esses filtros.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {grupos.map((g) => {
              const v = variacaoAtual(g);
              const img = v.imagem_url ?? g.imagem;
              const noCarrinho = carrinho[v.id]?.qtd ?? 0;
              const temVariacoes = g.totalVariacoes > 1;
              const itemBase = {
                id: v.id, nomeBase: g.nomeBase, marca: g.marca, variacao: v.variacao, preco: v.preco, imagem: img,
              };
              return (
                <div
                  key={g.grupoChave}
                  className="group bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col hover:shadow-xl hover:-translate-y-0.5 hover:border-[#e0b13c]/40 transition-all"
                >
                  <div className="relative aspect-square bg-white p-3 flex items-center justify-center overflow-hidden">
                    {temVariacoes && (
                      <span className="absolute top-2 left-2 z-10 bg-[#1b2a4e] text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                        {g.totalVariacoes} {rotuloVariacoes(g.variacaoTipo)}
                      </span>
                    )}
                    {img ? (
                      <img
                        src={img}
                        alt={g.nomeBase}
                        loading="lazy"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <span className="text-4xl text-slate-200">📦</span>
                    )}
                  </div>
                  <div className="px-3 pb-3 flex flex-col flex-1 border-t border-slate-100">
                    {g.marca && (
                      <div className="mt-2 text-[10px] font-bold text-[#c8941f] uppercase tracking-wide truncate">{g.marca}</div>
                    )}
                    <div className="text-[13px] text-slate-700 font-medium leading-snug line-clamp-2 min-h-[2.4rem] mt-0.5">{g.nomeBase}</div>

                    {/* Seletor de variação: chips até 6, select acima disso */}
                    {temVariacoes && (
                      <div className="mt-2">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
                          {rotuloVariacao(g.variacaoTipo)}
                        </div>
                        {g.variacoes.length <= 6 ? (
                          <div className="flex flex-wrap gap-1">
                            {g.variacoes.map((vv) => (
                              <button
                                key={vv.id}
                                onClick={() => setSelecionada((s) => ({ ...s, [g.grupoChave]: vv.id }))}
                                className={`rounded-md px-2 py-1 text-[11px] font-semibold border transition ${
                                  vv.id === v.id ? 'bg-[#1b2a4e] text-white border-[#1b2a4e]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#1b2a4e]/50'
                                }`}
                              >
                                {vv.variacao ?? 'Único'}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <select
                            value={v.id}
                            onChange={(e) => setSelecionada((s) => ({ ...s, [g.grupoChave]: Number(e.target.value) }))}
                            className="w-full rounded-lg border border-slate-300 text-[13px] px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e0b13c]"
                          >
                            {g.variacoes.map((vv) => (
                              <option key={vv.id} value={vv.id}>{vv.variacao ?? 'Único'}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    <div className="mt-2">
                      {g.precoMin !== g.precoMax && (
                        <span className="block text-[10px] text-slate-400 font-medium -mb-0.5">a partir de</span>
                      )}
                      <span className="text-lg font-extrabold text-[#1b2a4e]">{brl(v.preco)}</span>
                    </div>
                    <div className="mt-auto pt-2">
                      {noCarrinho === 0 ? (
                        <button
                          onClick={() => setQtd(itemBase, 1)}
                          className={`w-full ${BTN_OURO} text-sm font-bold rounded-lg py-2 transition`}
                        >
                          Adicionar
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-[#1b2a4e] rounded-lg text-white">
                          <button onClick={() => setQtd(itemBase, noCarrinho - 1)} className="w-10 h-9 text-lg font-bold hover:text-[#e0b13c]">−</button>
                          <span className="font-bold">{noCarrinho}</span>
                          <button onClick={() => setQtd(itemBase, noCarrinho + 1)} className="w-10 h-9 text-lg font-bold hover:text-[#e0b13c]">+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {grupos.length < total && (
          <div className="text-center mt-7">
            <button
              onClick={() => { const next = pagina + 1; setPagina(next); carregar(q, categoria, marca, next); }}
              disabled={carregando}
              className="bg-white border border-[#1b2a4e]/20 rounded-xl px-7 py-2.5 text-sm font-bold text-[#1b2a4e] hover:bg-[#1b2a4e] hover:text-white transition disabled:opacity-50"
            >
              {carregando ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#16223f] text-slate-400 safe-pb border-t-2 border-[#e0b13c]/30">
        <div className="max-w-6xl mx-auto px-4 py-7 flex flex-col items-center gap-3 text-center">
          <img src="/logowin.png" alt="WIN Distribuidora" className="h-12 w-12 rounded-lg" />
          <p className="text-sm font-semibold text-white">WIN Distribuidora</p>
          <p className="text-xs max-w-md">Catálogo online de suplementos. Faça seu pedido aqui e nossa equipe entra em contato pra confirmar.</p>
        </div>
      </footer>

      {/* Barra inferior fixa: atalho pro carrinho quando tem item */}
      {totalItens > 0 && !carrinhoAberto && (
        <button
          onClick={() => setCarrinhoAberto(true)}
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-20 ${BTN_OURO} rounded-full shadow-xl px-6 py-3 font-bold flex items-center gap-3 safe-pb`}
        >
          <span>Ver carrinho ({totalItens})</span>
          <span className="opacity-70">{brl(totalCarrinho)}</span>
        </button>
      )}

      {/* Drawer do carrinho / checkout */}
      {carrinhoAberto && (
        <div className="fixed inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} />
          <div className="relative bg-white w-full max-w-md h-full shadow-2xl flex flex-col safe-pt safe-pb">
            <div className="flex items-center justify-between px-5 py-4 bg-[#1b2a4e] text-white">
              <h2 className="font-bold">
                {vista === 'checkout' ? 'Seus dados' : 'Seu pedido'}
              </h2>
              <button onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
            </div>

            {itensCarrinho.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">Carrinho vazio.</div>
            ) : vista === 'checkout' ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[#1b2a4e]">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#e0b13c]"
                    placeholder="Seu nome"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#1b2a4e]">WhatsApp / Telefone</span>
                  <input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    inputMode="tel"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#e0b13c]"
                    placeholder="(86) 99999-9999"
                  />
                </label>
                {erroCheckout && <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">{erroCheckout}</div>}
                <div className="text-sm text-slate-500">
                  {totalItens} item(ns) · <span className="font-bold text-[#1b2a4e]">{brl(totalCarrinho)}</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {itensCarrinho.map((item) => (
                  <div key={item.id} className="flex gap-3 items-center">
                    <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                      {item.imagem ? (
                        <img src={item.imagem} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xl text-slate-300">📦</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2">
                        {item.nomeBase}
                        {item.variacao && <span className="text-slate-400"> · {item.variacao}</span>}
                      </div>
                      <div className="text-sm font-bold text-[#1b2a4e]">{brl(item.preco)}</div>
                    </div>
                    <div className="flex items-center gap-1 bg-[#1b2a4e] text-white rounded-lg shrink-0">
                      <button onClick={() => setQtd(item, item.qtd - 1)} className="w-8 h-8 text-lg font-bold hover:text-[#e0b13c]">−</button>
                      <span className="font-bold w-5 text-center">{item.qtd}</span>
                      <button onClick={() => setQtd(item, item.qtd + 1)} className="w-8 h-8 text-lg font-bold hover:text-[#e0b13c]">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {itensCarrinho.length > 0 && (
              <div className="border-t border-slate-200 p-5 space-y-3">
                <div className="flex justify-between font-extrabold text-[#1b2a4e] text-lg">
                  <span>Total</span>
                  <span>{brl(totalCarrinho)}</span>
                </div>
                {vista === 'checkout' ? (
                  <button
                    onClick={enviarPedido}
                    disabled={enviando}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3 transition disabled:opacity-60"
                  >
                    {enviando ? 'Enviando...' : 'Enviar pedido'}
                  </button>
                ) : (
                  <button
                    onClick={() => setVista('checkout')}
                    className={`w-full ${BTN_OURO} font-bold rounded-xl py-3 transition`}
                  >
                    Finalizar pedido
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
