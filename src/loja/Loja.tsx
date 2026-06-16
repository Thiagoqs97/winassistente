import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

// Botão de ação principal (dourado da logo WIN). Usado com parcimônia: hero e
// carrinho — não em cada card, pra não virar "grade de botões dourados".
const BTN_OURO =
  'bg-gradient-to-b from-gold-300 to-gold-500 hover:from-gold-200 hover:to-gold-600 text-navy-900 shadow-[0_8px_24px_-10px_rgba(207,156,44,0.7)]';

// Rótulo do seletor / contador conforme o tipo de variação.
const rotuloVariacao = (tipo: string | null) => (tipo === 'cor_tamanho' ? 'Opção' : 'Sabor');
const rotuloVariacoes = (tipo: string | null) => (tipo === 'cor_tamanho' ? 'opções' : 'sabores');

// Categorias com atalho no hero (só aparecem as que existem na vitrine).
const ATALHOS_HERO = ['proteinas', 'creatina', 'pre-treino', 'termogenicos'];

// Passos do hero (lado direito, editorial). Texto fixo — descreve o fluxo real.
const COMO_FUNCIONA = [
  { n: '01', t: 'Escolha no catálogo', d: 'Navegue por marca, categoria ou busque pelo nome.' },
  { n: '02', t: 'Monte o pedido', d: 'Adicione os itens e finalize com seus dados.' },
  { n: '03', t: 'Confirmamos no zap', d: 'Nossa equipe valida e fecha a entrega com você.' },
];

// --- Ícones monoline (stroke consistente, currentColor). Sem emoji. ---

type IconProps = { className?: string };

function IconSearch({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
function IconBag({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" />
    </svg>
  );
}
function IconPlus({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconMinus({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}
function IconArrow({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function IconCheck({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
function IconBox({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" />
    </svg>
  );
}
function IconWhats({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.8c2.17 0 4.2.84 5.74 2.38a8.07 8.07 0 0 1 2.38 5.73c0 4.47-3.64 8.11-8.12 8.11a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.2-.31a8.05 8.05 0 0 1-1.24-4.3c0-4.47 3.64-8.11 8.12-8.11Zm-2.6 4.36c-.13 0-.34.05-.52.24-.18.2-.69.68-.69 1.65 0 .97.71 1.91.81 2.04.1.13 1.39 2.21 3.43 3.01 1.7.67 2.05.54 2.42.5.37-.03 1.2-.49 1.37-.96.17-.47.17-.87.12-.96-.05-.08-.18-.13-.38-.23-.2-.1-1.2-.59-1.39-.66-.18-.07-.32-.1-.45.1-.13.2-.51.66-.63.79-.12.13-.23.15-.43.05-.2-.1-.85-.31-1.62-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.07-.13.03-.25-.02-.35-.05-.1-.44-1.08-.62-1.48-.16-.38-.33-.33-.45-.34l-.38-.01Z" />
    </svg>
  );
}

// Marca do produto em maiúsculas condensadas — usada na logo do header/footer.
function Wordmark({ size = 'base' }: { size?: 'base' | 'lg' }) {
  return (
    <span className="leading-none">
      <span className={`block font-display font-bold text-white tracking-wide ${size === 'lg' ? 'text-xl' : 'text-lg'}`}>WIN</span>
      <span className={`block font-display uppercase tracking-[0.34em] text-gold-400 ${size === 'lg' ? 'text-[10px]' : 'text-[9px]'}`}>Distribuidora</span>
    </span>
  );
}

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

  const produtosRef = useRef<HTMLDivElement>(null);

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

  const slugsDisponiveis = useMemo(() => new Set(categorias.map((c) => c.slug)), [categorias]);
  const atalhos = useMemo(
    () =>
      ATALHOS_HERO
        .filter((s) => slugsDisponiveis.has(s))
        .map((s) => categorias.find((c) => c.slug === s)!)
        .slice(0, 4),
    [slugsDisponiveis, categorias]
  );

  // Rola até a grade de produtos (com ou sem trocar o filtro).
  const irParaProdutos = (slug?: string) => {
    if (slug !== undefined) {
      setQ('');
      setMarca('');
      setCategoria(slug);
    }
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
      : 'Catálogo completo';

  if (vista === 'sucesso' && pedido) {
    return (
      <div className="min-h-screen bg-navy-800 bg-dots flex items-center justify-center p-4">
        <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center overflow-hidden animate-rise">
          <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-gold-300 via-gold-400 to-gold-600" />
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-5 ring-1 ring-emerald-100">
            <IconCheck className="w-8 h-8" />
          </div>
          <p className="font-display uppercase tracking-[0.22em] text-[11px] text-gold-600 font-semibold">Pedido recebido</p>
          <h1 className="font-display text-4xl font-bold text-ink mt-1 uppercase tracking-tight">{pedido.numero}</h1>
          <p className="text-slate-500 mt-3 text-sm leading-relaxed">
            Tudo certo, <span className="font-semibold text-ink">{pedido.clienteNome.split(' ')[0]}</span>!
            Registramos seu pedido e nossa equipe vai te chamar no WhatsApp pra confirmar.
          </p>
          <div className="mt-5 text-left bg-slate-50 rounded-2xl p-4 text-sm border border-slate-100">
            <div className="flex justify-between font-bold text-ink">
              <span>Total</span>
              <span className="font-display text-lg">{brl(pedido.total)}</span>
            </div>
            <p className="text-slate-400 mt-1">{pedido.itens.length} item(ns)</p>
          </div>
          <button
            onClick={novoPedido}
            className={`mt-6 w-full ${BTN_OURO} font-bold rounded-2xl py-3.5 transition-all active:scale-[0.99]`}
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f6f8] flex flex-col">
      {/* Barra utilitária */}
      <div className="bg-navy-950 text-slate-300 text-[11px] sm:text-xs safe-pt">
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center justify-between gap-2">
          <span className="font-display uppercase tracking-[0.22em] text-gold-400 font-semibold">WIN Distribuidora</span>
          <span className="hidden sm:inline text-slate-400 tracking-wide">Pedido pelo catálogo · confirmação no WhatsApp</span>
          <span className="sm:hidden text-slate-400">Suplementos</span>
        </div>
      </div>

      {/* Header principal */}
      <header className="sticky top-0 z-20 bg-navy-800/90 backdrop-blur-md shadow-lg border-b border-gold-400/20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <a href="/loja" className="order-1 flex items-center gap-2.5 shrink-0">
            <img src="/logowin.png" alt="WIN Distribuidora" className="h-10 w-10 rounded-lg ring-1 ring-white/10" />
            <span className="hidden sm:block"><Wordmark /></span>
          </a>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="order-3 basis-full sm:order-2 sm:basis-auto sm:flex-1 sm:max-w-xl sm:mx-auto relative"
          >
            <IconSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar whey, creatina, marca..."
              className="w-full rounded-xl border border-white/10 pl-10 pr-4 py-2.5 text-sm text-slate-700 bg-white/95 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:bg-white transition"
            />
          </form>
          <button
            onClick={() => setCarrinhoAberto(true)}
            className="order-2 sm:order-3 relative rounded-xl bg-white/10 hover:bg-white/15 text-white border border-white/15 px-3.5 py-2.5 text-sm font-semibold transition shrink-0 flex items-center gap-2"
          >
            <IconBag className="w-5 h-5" />
            <span className="hidden sm:inline">Carrinho</span>
            {totalItens > 0 && (
              <span className="absolute -top-2 -right-2 bg-gold-400 text-navy-900 text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold ring-2 ring-navy-800">
                {totalItens}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* HERO editorial 100% desenhado (sem foto): aurora dourada + grade técnica + grão */}
      <section className="hero-aurora grain relative overflow-hidden text-white isolate">
        <div className="tech-grid absolute inset-0" aria-hidden />
        <div className="absolute left-0 top-0 h-full w-1 sm:w-1.5 bg-gradient-to-b from-gold-300 via-gold-500 to-transparent animate-grow" />

        <div className="relative z-10 max-w-6xl mx-auto px-4 py-16 sm:py-24 lg:py-28 lg:grid lg:grid-cols-[1.45fr_0.85fr] lg:items-center lg:gap-14">
          {/* Coluna principal */}
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 animate-rise" style={{ animationDelay: '60ms' }}>
              <span className="h-px w-8 bg-gold-400" />
              <span className="font-display uppercase tracking-[0.3em] text-[11px] sm:text-xs text-gold-400 font-semibold">
                Distribuidora de suplementos
              </span>
            </div>
            <h1
              className="mt-5 font-display font-bold uppercase leading-[0.92] tracking-tight text-balance text-[2.6rem] sm:text-6xl lg:text-[4.6rem] animate-rise"
              style={{ animationDelay: '130ms' }}
            >
              Do whey ao
              <br className="hidden sm:block" /> pré-treino,
              <br />
              <span className="text-gold-400">no melhor preço.</span>
            </h1>
            <p
              className="mt-6 text-slate-300 text-sm sm:text-lg max-w-md leading-relaxed animate-rise"
              style={{ animationDelay: '210ms' }}
            >
              Monte seu pedido direto pelo catálogo e finalize em minutos. Nossa equipe
              confirma tudo com você pelo WhatsApp.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 animate-rise" style={{ animationDelay: '290ms' }}>
              <button
                onClick={() => irParaProdutos()}
                className={`inline-flex items-center gap-2 ${BTN_OURO} rounded-xl px-6 py-3.5 text-sm font-bold transition-all active:scale-[0.98]`}
              >
                Ver produtos <IconArrow className="w-4 h-4" />
              </button>
              {atalhos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {atalhos.map((c) => (
                    <button
                      key={c.slug}
                      onClick={() => irParaProdutos(c.slug)}
                      className="rounded-xl border border-white/15 bg-white/[0.04] backdrop-blur-sm hover:border-gold-400/70 hover:text-gold-300 text-slate-200 px-3.5 py-2.5 text-xs font-semibold transition"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selos de confiança */}
            <div className="mt-9 flex flex-wrap gap-x-7 gap-y-2.5 animate-rise" style={{ animationDelay: '370ms' }}>
              {['Marcas oficiais', 'Atacado e varejo', 'Atendimento humano'].map((t) => (
                <span key={t} className="inline-flex items-center gap-2 text-slate-300 text-xs sm:text-sm">
                  <IconCheck className="w-4 h-4 text-gold-400" /> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Painel editorial "Como funciona" (lg+) */}
          <div
            className="hidden lg:block mt-0 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-7 animate-rise"
            style={{ animationDelay: '320ms' }}
          >
            <p className="font-display uppercase tracking-[0.24em] text-[11px] text-gold-400 font-semibold">Como funciona</p>
            <div className="mt-5 space-y-5">
              {COMO_FUNCIONA.map((p) => (
                <div key={p.n} className="flex gap-4">
                  <span className="font-display text-2xl font-bold text-gold-400/80 tabular-nums leading-none pt-0.5">{p.n}</span>
                  <div>
                    <div className="font-display uppercase tracking-wide text-base font-semibold text-white leading-tight">{p.t}</div>
                    <p className="text-slate-400 text-sm mt-0.5 leading-snug">{p.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Faixa de marcas reais */}
      {marcas.length > 0 && (
        <div className="bg-navy-700 border-y border-white/5">
          <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center gap-5 overflow-x-auto no-scrollbar">
            <span className="shrink-0 font-display uppercase text-[10px] tracking-[0.22em] text-slate-500 font-semibold">
              Marcas que trabalhamos
            </span>
            <div className="flex items-center gap-2.5">
              {marcas.slice(0, 12).map((m, i) => (
                <span key={m.marca} className="flex items-center gap-2.5">
                  {i > 0 && <span className="w-1 h-1 rounded-full bg-slate-600" />}
                  <button
                    onClick={() => { setMarca(m.marca); irParaProdutos(); }}
                    className="shrink-0 font-display uppercase tracking-wide text-sm text-slate-400 hover:text-gold-400 transition whitespace-nowrap"
                  >
                    {m.marca}
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Barra de filtros (sticky) */}
      <div className="bg-white/90 backdrop-blur border-b border-slate-200 sticky top-[64px] z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <button
              onClick={() => setCategoria('')}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition border ${
                categoria === '' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-200 hover:border-navy-700/40'
              }`}
            >
              Todos
            </button>
            {categorias.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCategoria((cur) => (cur === c.slug ? '' : c.slug))}
                className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition border ${
                  categoria === c.slug ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-200 hover:border-navy-700/40'
                }`}
              >
                {c.label} <span className={`ml-0.5 ${categoria === c.slug ? 'text-gold-300' : 'text-slate-400'}`}>{c.total}</span>
              </button>
            ))}
          </div>
          {marcas.length > 0 && (
            <select
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              className="shrink-0 rounded-full border border-slate-300 text-sm px-3.5 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400 max-w-[40vw]"
            >
              <option value="">Todas as marcas</option>
              {marcas.map((m) => (
                <option key={m.marca} value={m.marca}>{m.marca} ({m.total})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 pb-28">
        <div ref={produtosRef} className="scroll-mt-32 flex items-end justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="h-7 w-1.5 rounded-full bg-gradient-to-b from-gold-300 to-gold-500" />
            <div>
              <h2 className="font-display uppercase tracking-tight text-2xl sm:text-3xl font-bold text-ink leading-none">{tituloLista}</h2>
              {total > 0 && <span className="text-xs text-slate-400 font-medium">{total} {total === 1 ? 'item' : 'itens'} disponíveis</span>}
            </div>
          </div>
        </div>

        {erro && (
          <div className="bg-red-50 text-red-700 rounded-2xl p-4 text-sm mb-4 border border-red-100">{erro}</div>
        )}

        {carregando && grupos.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="aspect-square bg-slate-100 animate-pulse" />
                <div className="p-3.5 space-y-2.5">
                  <div className="h-2.5 w-1/3 bg-slate-100 rounded animate-pulse" />
                  <div className="h-3 w-3/4 bg-slate-100 rounded animate-pulse" />
                  <div className="h-6 w-1/2 bg-slate-100 rounded animate-pulse" />
                  <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : grupos.length === 0 ? (
          <div className="text-center text-slate-400 py-24">
            <IconBox className="w-12 h-12 mx-auto mb-3 text-slate-200" />
            {semFiltro ? 'Nenhum produto disponível no momento.' : 'Nenhum produto encontrado com esses filtros.'}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
            {grupos.map((g, i) => {
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
                  className="group bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden flex flex-col hover:shadow-card-hover hover:border-gold-400/40 hover:-translate-y-1 transition-all duration-300 animate-rise"
                  style={{ animationDelay: `${Math.min(i, 7) * 45}ms` }}
                >
                  <div className="relative aspect-square bg-gradient-to-br from-slate-50 to-white p-4 flex items-center justify-center overflow-hidden">
                    {/* canto decorativo dourado, aparece no hover */}
                    <span className="absolute -top-px -right-px w-10 h-10 bg-gold-400/0 group-hover:bg-gold-400/10 [clip-path:polygon(100%_0,0_0,100%_100%)] transition-colors" />
                    {temVariacoes && (
                      <span className="absolute top-2.5 left-2.5 z-10 bg-navy-800/90 backdrop-blur-sm text-gold-300 text-[10px] font-semibold rounded-md px-2 py-1 font-display uppercase tracking-wide">
                        {g.totalVariacoes} {rotuloVariacoes(g.variacaoTipo)}
                      </span>
                    )}
                    {img ? (
                      <img
                        src={img}
                        alt={g.nomeBase}
                        loading="lazy"
                        className="w-full h-full object-contain group-hover:scale-[1.06] transition-transform duration-500 ease-out drop-shadow-sm"
                      />
                    ) : (
                      <IconBox className="w-10 h-10 text-slate-200" />
                    )}
                  </div>
                  <div className="px-3.5 pb-3.5 flex flex-col flex-1 border-t border-slate-100">
                    {g.marca && (
                      <div className="mt-3 font-display text-[10px] font-semibold text-gold-600 uppercase tracking-[0.14em] truncate">{g.marca}</div>
                    )}
                    <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-2 min-h-[2.4rem] mt-0.5">{g.nomeBase}</div>

                    {temVariacoes && (
                      <div className="mt-3">
                        <div className="font-display text-[10px] uppercase tracking-[0.14em] text-slate-400 font-semibold mb-1.5">
                          {rotuloVariacao(g.variacaoTipo)}
                        </div>
                        {g.variacoes.length <= 6 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {g.variacoes.map((vv) => (
                              <button
                                key={vv.id}
                                onClick={() => setSelecionada((s) => ({ ...s, [g.grupoChave]: vv.id }))}
                                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition ${
                                  vv.id === v.id ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-200 hover:border-navy-700/50'
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
                            className="w-full rounded-lg border border-slate-300 text-[13px] px-2.5 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-gold-400"
                          >
                            {g.variacoes.map((vv) => (
                              <option key={vv.id} value={vv.id}>{vv.variacao ?? 'Único'}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    <div className="mt-3.5">
                      {g.precoMin !== g.precoMax && (
                        <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wide -mb-0.5">a partir de</span>
                      )}
                      <span className="font-display text-2xl font-bold text-ink tracking-tight tabular-nums">{brl(v.preco)}</span>
                    </div>
                    <div className="mt-auto pt-3.5">
                      {noCarrinho === 0 ? (
                        <button
                          onClick={() => setQtd(itemBase, 1)}
                          className="w-full bg-navy-700 hover:bg-navy-800 text-white text-sm font-semibold rounded-xl py-2.5 transition flex items-center justify-center gap-2 active:scale-[0.98]"
                        >
                          <IconBag className="w-4 h-4 text-gold-400" /> Adicionar
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-navy-700 rounded-xl text-white">
                          <button onClick={() => setQtd(itemBase, noCarrinho - 1)} className="w-11 h-10 flex items-center justify-center hover:text-gold-400 transition"><IconMinus className="w-4 h-4" /></button>
                          <span className="font-bold tabular-nums">{noCarrinho}</span>
                          <button onClick={() => setQtd(itemBase, noCarrinho + 1)} className="w-11 h-10 flex items-center justify-center hover:text-gold-400 transition"><IconPlus className="w-4 h-4" /></button>
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
          <div className="text-center mt-10">
            <button
              onClick={() => { const next = pagina + 1; setPagina(next); carregar(q, categoria, marca, next); }}
              disabled={carregando}
              className="bg-white border border-navy-700/20 rounded-xl px-8 py-3 text-sm font-semibold text-navy-700 hover:bg-navy-700 hover:text-white hover:border-navy-700 transition disabled:opacity-50"
            >
              {carregando ? 'Carregando...' : 'Carregar mais produtos'}
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-navy-950 text-slate-400 safe-pb border-t-2 border-gold-400/30">
        <div className="max-w-6xl mx-auto px-4 py-12 grid sm:grid-cols-[1.4fr_1fr] gap-8">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logowin.png" alt="WIN Distribuidora" className="h-11 w-11 rounded-lg ring-1 ring-white/10" />
              <Wordmark size="lg" />
            </div>
            <p className="text-sm mt-4 max-w-sm leading-relaxed">
              Catálogo online de suplementos. Monte seu pedido por aqui e nossa equipe
              entra em contato pra confirmar e fechar a entrega.
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-display uppercase tracking-[0.2em] text-[11px] text-slate-500 font-semibold mb-3">Atendimento</p>
            <span className="inline-flex items-center gap-2 text-gold-400 font-semibold">
              <IconWhats className="w-5 h-5" /> Pedido confirmado pelo WhatsApp
            </span>
            <p className="text-xs text-slate-500 mt-3">Segunda a sexta · horário comercial</p>
          </div>
        </div>
        <div className="border-t border-white/5">
          <div className="max-w-6xl mx-auto px-4 py-4 text-[11px] text-slate-500 flex flex-col sm:flex-row gap-1 sm:justify-between">
            <span>© 2026 WIN Distribuidora — Todos os direitos reservados.</span>
            <span>Preços sujeitos a confirmação no pedido.</span>
          </div>
        </div>
      </footer>

      {/* Barra inferior fixa: atalho pro carrinho */}
      {totalItens > 0 && !carrinhoAberto && (
        <button
          onClick={() => setCarrinhoAberto(true)}
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-20 ${BTN_OURO} rounded-full px-6 py-3.5 font-bold flex items-center gap-3 safe-pb animate-rise`}
        >
          <IconBag className="w-5 h-5" />
          <span>Ver carrinho ({totalItens})</span>
          <span className="opacity-70 font-display tabular-nums">{brl(totalCarrinho)}</span>
        </button>
      )}

      {/* Drawer do carrinho / checkout */}
      {carrinhoAberto && (
        <div className="fixed inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm animate-fade" onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} />
          <div className="relative bg-white w-full max-w-md h-full shadow-2xl flex flex-col safe-pt safe-pb">
            <div className="flex items-center justify-between px-5 py-4 bg-navy-800 text-white">
              <h2 className="font-display uppercase tracking-wide font-bold text-lg">
                {vista === 'checkout' ? 'Seus dados' : 'Seu pedido'}
              </h2>
              <button onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} className="text-white/70 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition">×</button>
            </div>

            {itensCarrinho.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                <IconBag className="w-10 h-10 text-slate-200" />
                Carrinho vazio.
              </div>
            ) : vista === 'checkout' ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-ink">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-gold-400"
                    placeholder="Seu nome"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-ink">WhatsApp / Telefone</span>
                  <input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    inputMode="tel"
                    className="mt-1.5 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-gold-400"
                    placeholder="(86) 99999-9999"
                  />
                </label>
                {erroCheckout && <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm border border-red-100">{erroCheckout}</div>}
                <div className="text-sm text-slate-500">
                  {totalItens} item(ns) · <span className="font-bold text-ink">{brl(totalCarrinho)}</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {itensCarrinho.map((item) => (
                  <div key={item.id} className="flex gap-3 items-center">
                    <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                      {item.imagem ? (
                        <img src={item.imagem} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <IconBox className="w-6 h-6 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2">
                        {item.nomeBase}
                        {item.variacao && <span className="text-slate-400"> · {item.variacao}</span>}
                      </div>
                      <div className="text-sm font-bold text-ink font-display">{brl(item.preco)}</div>
                    </div>
                    <div className="flex items-center gap-1 bg-navy-700 text-white rounded-xl shrink-0">
                      <button onClick={() => setQtd(item, item.qtd - 1)} className="w-8 h-8 flex items-center justify-center hover:text-gold-400 transition"><IconMinus className="w-4 h-4" /></button>
                      <span className="font-bold w-5 text-center tabular-nums">{item.qtd}</span>
                      <button onClick={() => setQtd(item, item.qtd + 1)} className="w-8 h-8 flex items-center justify-center hover:text-gold-400 transition"><IconPlus className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {itensCarrinho.length > 0 && (
              <div className="border-t border-slate-200 p-5 space-y-3">
                <div className="flex justify-between font-bold text-ink text-lg">
                  <span>Total</span>
                  <span className="font-display text-xl tabular-nums">{brl(totalCarrinho)}</span>
                </div>
                {vista === 'checkout' ? (
                  <button
                    onClick={enviarPedido}
                    disabled={enviando}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3.5 transition disabled:opacity-60 flex items-center justify-center gap-2 active:scale-[0.99]"
                  >
                    <IconWhats className="w-5 h-5" /> {enviando ? 'Enviando...' : 'Enviar pedido'}
                  </button>
                ) : (
                  <button
                    onClick={() => setVista('checkout')}
                    className={`w-full ${BTN_OURO} font-bold rounded-xl py-3.5 transition-all active:scale-[0.99]`}
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
