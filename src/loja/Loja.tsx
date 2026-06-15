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
  'bg-gradient-to-b from-[#eebf57] to-[#cf9c2c] hover:from-[#f3cd6c] hover:to-[#c08f1f] text-[#0e1830]';

// Rótulo do seletor / contador conforme o tipo de variação.
const rotuloVariacao = (tipo: string | null) => (tipo === 'cor_tamanho' ? 'Opção' : 'Sabor');
const rotuloVariacoes = (tipo: string | null) => (tipo === 'cor_tamanho' ? 'opções' : 'sabores');

// Categorias com atalho no hero (só aparecem as que existem na vitrine).
const ATALHOS_HERO = ['proteinas', 'creatina', 'pre-treino', 'termogenicos'];

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
  const [destaques, setDestaques] = useState<Grupo[]>([]); // produtos reais p/ a vitrine do hero

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

  // Filtros + vitrine do hero (uma vez no mount). Os destaques saem do catálogo
  // real (primeiros itens com imagem) — não confiamos em imagem "fake".
  useEffect(() => {
    apiFetch<Categoria[]>('/api/loja/categorias').then(setCategorias).catch(() => {});
    apiFetch<Marca[]>('/api/loja/marcas').then(setMarcas).catch(() => {});
    apiFetch<{ itens: Grupo[] }>('/api/loja/produtos?pagina=1&limite=16')
      .then((out) => setDestaques(out.itens.filter((g) => g.imagem).slice(0, 3)))
      .catch(() => {});
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
      <div className="min-h-screen bg-[#0b1530] bg-dots flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-5 ring-1 ring-emerald-100">
            <IconCheck className="w-8 h-8" />
          </div>
          <p className="font-display uppercase tracking-[0.18em] text-[11px] text-[#c8941f] font-semibold">Pedido recebido</p>
          <h1 className="font-display text-3xl font-bold text-[#111d3a] mt-1 uppercase">{pedido.numero}</h1>
          <p className="text-slate-500 mt-3 text-sm leading-relaxed">
            Tudo certo, <span className="font-semibold text-[#111d3a]">{pedido.clienteNome.split(' ')[0]}</span>!
            Registramos seu pedido e nossa equipe vai te chamar no WhatsApp pra confirmar.
          </p>
          <div className="mt-5 text-left bg-slate-50 rounded-xl p-4 text-sm border border-slate-100">
            <div className="flex justify-between font-bold text-[#111d3a]">
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
    <div className="min-h-screen bg-[#f4f5f7] flex flex-col">
      {/* Barra utilitária */}
      <div className="bg-[#0b1530] text-slate-300 text-[11px] sm:text-xs safe-pt">
        <div className="max-w-6xl mx-auto px-4 py-1.5 flex items-center justify-between gap-2">
          <span className="font-display uppercase tracking-[0.18em] text-[#e6b94d] font-semibold">WIN Distribuidora</span>
          <span className="hidden sm:inline text-slate-400">Pedido pelo catálogo · confirmação no WhatsApp</span>
          <span className="sm:hidden text-slate-400">Suplementos</span>
        </div>
      </div>

      {/* Header principal */}
      <header className="sticky top-0 z-20 bg-[#111d3a]/95 backdrop-blur shadow-lg border-b border-[#e6b94d]/25">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <a href="/loja" className="order-1 flex items-center gap-2.5 shrink-0">
            <img src="/logowin.png" alt="WIN Distribuidora" className="h-10 w-10 rounded-md ring-1 ring-white/10" />
            <span className="hidden sm:block leading-none">
              <span className="block font-display text-lg font-bold text-white tracking-wide">WIN</span>
              <span className="block font-display uppercase text-[9px] tracking-[0.22em] text-[#e6b94d]">Distribuidora</span>
            </span>
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
              className="w-full rounded-lg border border-transparent pl-10 pr-4 py-2.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e6b94d]"
            />
          </form>
          <button
            onClick={() => setCarrinhoAberto(true)}
            className="order-2 sm:order-3 relative rounded-lg bg-white/10 hover:bg-white/15 text-white border border-white/15 px-3.5 py-2.5 text-sm font-semibold transition shrink-0 flex items-center gap-2"
          >
            <IconBag className="w-5 h-5" />
            <span className="hidden sm:inline">Carrinho</span>
            {totalItens > 0 && (
              <span className="absolute -top-2 -right-2 bg-[#e6b94d] text-[#0e1830] text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold ring-2 ring-[#111d3a]">
                {totalItens}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* HERO editorial */}
      <section className="relative overflow-hidden bg-[#0b1530] text-white">
        {/* Camadas de fundo: brilho dourado + grade pontilhada + wordmark gigante */}
        <div className="absolute inset-0 bg-dots opacity-70" />
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_15%,rgba(230,185,77,0.18),transparent_55%)]" />
        <div className="absolute -right-6 -bottom-10 select-none pointer-events-none font-display font-bold uppercase text-[28vw] sm:text-[16rem] leading-none text-white/[0.03] tracking-tighter">
          WIN
        </div>
        <div className="absolute left-0 top-0 h-full w-1 sm:w-1.5 bg-gradient-to-b from-[#e6b94d] via-[#cf9c2c] to-transparent" />

        <div className="relative max-w-6xl mx-auto px-4 py-12 sm:py-16 lg:py-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-10 items-center">
          {/* Coluna do texto */}
          <div>
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-[#e6b94d]" />
              <span className="font-display uppercase tracking-[0.28em] text-[11px] sm:text-xs text-[#e6b94d] font-semibold">
                Distribuidora de suplementos
              </span>
            </div>
            <h1 className="mt-4 font-display font-bold uppercase leading-[0.95] tracking-tight text-balance text-4xl sm:text-6xl lg:text-[4.4rem]">
              Do whey ao
              <br />
              pré-treino,
              <br />
              <span className="text-[#e6b94d]">no melhor preço.</span>
            </h1>
            <p className="mt-5 text-slate-300 text-sm sm:text-lg max-w-md leading-relaxed">
              Monte seu pedido direto pelo catálogo e finalize em minutos. Nossa equipe
              confirma tudo com você pelo WhatsApp.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={() => irParaProdutos()}
                className={`inline-flex items-center gap-2 ${BTN_OURO} rounded-lg px-6 py-3 text-sm font-bold transition`}
              >
                Ver produtos <IconArrow className="w-4 h-4" />
              </button>
              {atalhos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500 text-xs hidden sm:inline">Atalhos:</span>
                  {atalhos.map((c) => (
                    <button
                      key={c.slug}
                      onClick={() => irParaProdutos(c.slug)}
                      className="rounded-lg border border-white/15 hover:border-[#e6b94d]/70 hover:text-[#e6b94d] text-slate-200 px-3 py-2 text-xs font-semibold transition"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selos de confiança */}
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              {['Marcas oficiais', 'Atacado e varejo', 'Atendimento humano'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5 text-slate-400 text-xs sm:text-sm">
                  <IconCheck className="w-4 h-4 text-[#e6b94d]" /> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Coluna da vitrine: produtos REAIS do catálogo num "palco" dourado */}
          <div className="relative hidden lg:block h-[400px]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(230,185,77,0.22),transparent_62%)]" />
            <div className="relative h-full flex items-end justify-center gap-5">
              {destaques.length > 0 ? (
                destaques.map((g, i) => (
                  <div
                    key={g.grupoChave}
                    className={`relative bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 p-4 flex flex-col ${
                      i === 1 ? 'w-44 h-72 z-10' : 'w-40 h-60 mb-8 opacity-95'
                    }`}
                  >
                    <div className="flex-1 flex items-center justify-center overflow-hidden">
                      <img src={g.imagem!} alt={g.nomeBase} className="max-h-full max-w-full object-contain" />
                    </div>
                    <div className="pt-2 border-t border-slate-100">
                      {g.marca && (
                        <p className="font-display uppercase text-[9px] tracking-wider text-[#c8941f] font-semibold truncate">{g.marca}</p>
                      )}
                      <p className="text-[#111d3a] font-bold text-sm">{brl(g.precoMin)}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-white/20 font-display uppercase tracking-widest text-sm">Carregando vitrine…</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Faixa de marcas reais */}
      {marcas.length > 0 && (
        <div className="bg-[#111d3a] border-t border-white/5">
          <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center gap-4 overflow-x-auto no-scrollbar">
            <span className="shrink-0 font-display uppercase text-[10px] tracking-[0.2em] text-slate-500 font-semibold">
              Marcas que trabalhamos
            </span>
            <div className="flex items-center gap-6">
              {marcas.slice(0, 12).map((m) => (
                <button
                  key={m.marca}
                  onClick={() => { setMarca(m.marca); irParaProdutos(); }}
                  className="shrink-0 font-display uppercase tracking-wide text-sm text-slate-400 hover:text-[#e6b94d] transition whitespace-nowrap"
                >
                  {m.marca}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Barra de filtros (sticky) */}
      <div className="bg-white border-b border-slate-200 sticky top-[64px] z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
          <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
            <button
              onClick={() => setCategoria('')}
              className={`shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold transition border ${
                categoria === '' ? 'bg-[#111d3a] text-white border-[#111d3a]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#111d3a]/40'
              }`}
            >
              Todos
            </button>
            {categorias.map((c) => (
              <button
                key={c.slug}
                onClick={() => setCategoria((cur) => (cur === c.slug ? '' : c.slug))}
                className={`shrink-0 rounded-md px-3.5 py-1.5 text-xs font-semibold transition border ${
                  categoria === c.slug ? 'bg-[#111d3a] text-white border-[#111d3a]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#111d3a]/40'
                }`}
              >
                {c.label} <span className="opacity-50 ml-0.5">{c.total}</span>
              </button>
            ))}
          </div>
          {marcas.length > 0 && (
            <select
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              className="shrink-0 rounded-md border border-slate-300 text-sm px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e6b94d] max-w-[40vw]"
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
        <div ref={produtosRef} className="scroll-mt-32 flex items-end justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="h-5 w-1 rounded bg-[#e6b94d]" />
            <h2 className="font-display uppercase tracking-wide text-xl sm:text-2xl font-bold text-[#111d3a]">{tituloLista}</h2>
          </div>
          {total > 0 && <span className="text-xs text-slate-400 pb-1">{total} itens</span>}
        </div>

        {erro && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm mb-4">{erro}</div>
        )}

        {carregando && grupos.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <div className="aspect-square bg-slate-100 animate-pulse" />
                <div className="p-3 space-y-2">
                  <div className="h-2.5 w-1/3 bg-slate-100 rounded animate-pulse" />
                  <div className="h-3 w-3/4 bg-slate-100 rounded animate-pulse" />
                  <div className="h-5 w-1/2 bg-slate-100 rounded animate-pulse" />
                  <div className="h-9 w-full bg-slate-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : grupos.length === 0 ? (
          <div className="text-center text-slate-400 py-24">
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
                  className="group bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col hover:shadow-xl hover:border-[#111d3a]/20 hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div className="relative aspect-square bg-gradient-to-b from-white to-slate-50 p-4 flex items-center justify-center overflow-hidden">
                    {temVariacoes && (
                      <span className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-sm text-[#111d3a] border border-slate-200 text-[10px] font-semibold rounded px-1.5 py-0.5 font-display uppercase tracking-wide">
                        {g.totalVariacoes} {rotuloVariacoes(g.variacaoTipo)}
                      </span>
                    )}
                    {img ? (
                      <img
                        src={img}
                        alt={g.nomeBase}
                        loading="lazy"
                        className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <IconBox className="w-10 h-10 text-slate-200" />
                    )}
                  </div>
                  <div className="px-3 pb-3 flex flex-col flex-1 border-t border-slate-100">
                    {g.marca && (
                      <div className="mt-2.5 font-display text-[10px] font-semibold text-[#c8941f] uppercase tracking-[0.12em] truncate">{g.marca}</div>
                    )}
                    <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-2 min-h-[2.4rem] mt-0.5">{g.nomeBase}</div>

                    {temVariacoes && (
                      <div className="mt-2.5">
                        <div className="font-display text-[10px] uppercase tracking-[0.12em] text-slate-400 font-semibold mb-1">
                          {rotuloVariacao(g.variacaoTipo)}
                        </div>
                        {g.variacoes.length <= 6 ? (
                          <div className="flex flex-wrap gap-1">
                            {g.variacoes.map((vv) => (
                              <button
                                key={vv.id}
                                onClick={() => setSelecionada((s) => ({ ...s, [g.grupoChave]: vv.id }))}
                                className={`rounded px-2 py-1 text-[11px] font-semibold border transition ${
                                  vv.id === v.id ? 'bg-[#111d3a] text-white border-[#111d3a]' : 'bg-white text-slate-600 border-slate-200 hover:border-[#111d3a]/50'
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
                            className="w-full rounded-md border border-slate-300 text-[13px] px-2 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#e6b94d]"
                          >
                            {g.variacoes.map((vv) => (
                              <option key={vv.id} value={vv.id}>{vv.variacao ?? 'Único'}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    <div className="mt-3">
                      {g.precoMin !== g.precoMax && (
                        <span className="block text-[10px] text-slate-400 font-medium -mb-0.5">a partir de</span>
                      )}
                      <span className="font-display text-xl font-bold text-[#111d3a] tracking-tight">{brl(v.preco)}</span>
                    </div>
                    <div className="mt-auto pt-3">
                      {noCarrinho === 0 ? (
                        <button
                          onClick={() => setQtd(itemBase, 1)}
                          className="w-full bg-[#13213f] hover:bg-[#0d1830] text-white text-sm font-semibold rounded-md py-2.5 transition flex items-center justify-center gap-1.5"
                        >
                          <IconBag className="w-4 h-4 text-[#e6b94d]" /> Adicionar
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-[#13213f] rounded-md text-white">
                          <button onClick={() => setQtd(itemBase, noCarrinho - 1)} className="w-11 h-10 flex items-center justify-center hover:text-[#e6b94d]"><IconMinus className="w-4 h-4" /></button>
                          <span className="font-bold tabular-nums">{noCarrinho}</span>
                          <button onClick={() => setQtd(itemBase, noCarrinho + 1)} className="w-11 h-10 flex items-center justify-center hover:text-[#e6b94d]"><IconPlus className="w-4 h-4" /></button>
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
          <div className="text-center mt-8">
            <button
              onClick={() => { const next = pagina + 1; setPagina(next); carregar(q, categoria, marca, next); }}
              disabled={carregando}
              className="bg-white border border-[#111d3a]/20 rounded-lg px-8 py-3 text-sm font-semibold text-[#111d3a] hover:bg-[#111d3a] hover:text-white transition disabled:opacity-50"
            >
              {carregando ? 'Carregando...' : 'Carregar mais produtos'}
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#0b1530] text-slate-400 safe-pb border-t-2 border-[#e6b94d]/30">
        <div className="max-w-6xl mx-auto px-4 py-10 grid sm:grid-cols-[1.4fr_1fr] gap-8">
          <div>
            <div className="flex items-center gap-3">
              <img src="/logowin.png" alt="WIN Distribuidora" className="h-11 w-11 rounded-md ring-1 ring-white/10" />
              <span className="leading-none">
                <span className="block font-display text-xl font-bold text-white tracking-wide">WIN</span>
                <span className="block font-display uppercase text-[10px] tracking-[0.22em] text-[#e6b94d]">Distribuidora</span>
              </span>
            </div>
            <p className="text-sm mt-4 max-w-sm leading-relaxed">
              Catálogo online de suplementos. Monte seu pedido por aqui e nossa equipe
              entra em contato pra confirmar e fechar a entrega.
            </p>
          </div>
          <div className="sm:text-right">
            <p className="font-display uppercase tracking-[0.18em] text-[11px] text-slate-500 font-semibold mb-3">Atendimento</p>
            <span className="inline-flex items-center gap-2 text-[#e6b94d] font-semibold">
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
          className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-20 ${BTN_OURO} rounded-full shadow-2xl px-6 py-3 font-bold flex items-center gap-3 safe-pb`}
        >
          <IconBag className="w-5 h-5" />
          <span>Ver carrinho ({totalItens})</span>
          <span className="opacity-70 font-display">{brl(totalCarrinho)}</span>
        </button>
      )}

      {/* Drawer do carrinho / checkout */}
      {carrinhoAberto && (
        <div className="fixed inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} />
          <div className="relative bg-white w-full max-w-md h-full shadow-2xl flex flex-col safe-pt safe-pb">
            <div className="flex items-center justify-between px-5 py-4 bg-[#111d3a] text-white">
              <h2 className="font-display uppercase tracking-wide font-bold text-lg">
                {vista === 'checkout' ? 'Seus dados' : 'Seu pedido'}
              </h2>
              <button onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} className="text-white/70 hover:text-white text-2xl leading-none">×</button>
            </div>

            {itensCarrinho.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                <IconBag className="w-10 h-10 text-slate-200" />
                Carrinho vazio.
              </div>
            ) : vista === 'checkout' ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-semibold text-[#111d3a]">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#e6b94d]"
                    placeholder="Seu nome"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-[#111d3a]">WhatsApp / Telefone</span>
                  <input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    inputMode="tel"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#e6b94d]"
                    placeholder="(86) 99999-9999"
                  />
                </label>
                {erroCheckout && <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">{erroCheckout}</div>}
                <div className="text-sm text-slate-500">
                  {totalItens} item(ns) · <span className="font-bold text-[#111d3a]">{brl(totalCarrinho)}</span>
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
                        <IconBox className="w-6 h-6 text-slate-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2">
                        {item.nomeBase}
                        {item.variacao && <span className="text-slate-400"> · {item.variacao}</span>}
                      </div>
                      <div className="text-sm font-bold text-[#111d3a]">{brl(item.preco)}</div>
                    </div>
                    <div className="flex items-center gap-1 bg-[#13213f] text-white rounded-lg shrink-0">
                      <button onClick={() => setQtd(item, item.qtd - 1)} className="w-8 h-8 flex items-center justify-center hover:text-[#e6b94d]"><IconMinus className="w-4 h-4" /></button>
                      <span className="font-bold w-5 text-center tabular-nums">{item.qtd}</span>
                      <button onClick={() => setQtd(item, item.qtd + 1)} className="w-8 h-8 flex items-center justify-center hover:text-[#e6b94d]"><IconPlus className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {itensCarrinho.length > 0 && (
              <div className="border-t border-slate-200 p-5 space-y-3">
                <div className="flex justify-between font-bold text-[#111d3a] text-lg">
                  <span>Total</span>
                  <span className="font-display">{brl(totalCarrinho)}</span>
                </div>
                {vista === 'checkout' ? (
                  <button
                    onClick={enviarPedido}
                    disabled={enviando}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl py-3 transition disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <IconWhats className="w-5 h-5" /> {enviando ? 'Enviando...' : 'Enviar pedido'}
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
