import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';

interface Produto {
  id: number;
  descricao: string;
  marca: string | null;
  preco: number | null;
  imagem_url: string | null;
}

interface ItemCarrinho {
  produto: Produto;
  qtd: number;
}

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

export default function Loja() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [carrinho, setCarrinho] = useState<Record<number, ItemCarrinho>>({});
  const [carrinhoAberto, setCarrinhoAberto] = useState(false);
  const [vista, setVista] = useState<'catalogo' | 'checkout' | 'sucesso'>('catalogo');

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroCheckout, setErroCheckout] = useState<string | null>(null);
  const [pedido, setPedido] = useState<ResultadoPedido | null>(null);

  const carregar = useCallback(async (busca: string, pag: number) => {
    setCarregando(true);
    setErro(null);
    try {
      const params = new URLSearchParams({ pagina: String(pag), limite: String(LIMITE) });
      if (busca.trim()) params.set('q', busca.trim());
      const out = await apiFetch<{ itens: Produto[]; total: number }>(`/api/loja/produtos?${params}`);
      setTotal(out.total);
      setProdutos((prev) => (pag === 1 ? out.itens : [...prev, ...out.itens]));
    } catch (err: any) {
      setErro(err?.message || 'Não consegui carregar os produtos.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // Busca com debounce: volta pra página 1 a cada termo novo.
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      carregar(q, 1);
    }, 350);
    return () => clearTimeout(t);
  }, [q, carregar]);

  const setQtd = (produto: Produto, qtd: number) => {
    setCarrinho((prev) => {
      const next = { ...prev };
      if (qtd <= 0) delete next[produto.id];
      else next[produto.id] = { produto, qtd };
      return next;
    });
  };

  const itensCarrinho = useMemo(() => Object.values(carrinho), [carrinho]);
  const totalItens = useMemo(() => itensCarrinho.reduce((s, i) => s + i.qtd, 0), [itensCarrinho]);
  const totalCarrinho = useMemo(
    () => itensCarrinho.reduce((s, i) => s + (i.produto.preco ?? 0) * i.qtd, 0),
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
          itens: itensCarrinho.map((i) => ({ produtoId: i.produto.id, qtd: i.qtd })),
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
    setPagina(1);
    carregar('', 1);
    setQ('');
  };

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
      <header className="sticky top-0 z-20 bg-[#1b2a4e] shadow-md">
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

      {/* Hero */}
      <section className="bg-gradient-to-br from-[#1b2a4e] to-[#16223f] text-white border-t border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-7 sm:py-10 text-center">
          <span className="inline-block text-[#e0b13c] font-bold tracking-[0.2em] text-xs mb-2">CATÁLOGO ONLINE</span>
          <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">
            Suplementos com o melhor da <span className="text-[#e0b13c]">WIN</span>
          </h1>
          <p className="text-slate-300 mt-2 text-sm sm:text-base">
            Escolha os produtos, monte seu carrinho e finalize — nossa equipe confirma o pedido com você.
          </p>
        </div>
      </section>

      {/* Selos */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['🏷️', 'Várias marcas'],
            ['💬', 'Atendimento humano'],
            ['📦', 'Pedido sem complicação'],
          ].map(([ic, txt]) => (
            <div key={txt} className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[11px] sm:text-sm text-slate-600 font-medium">
              <span className="text-lg">{ic}</span>
              <span>{txt}</span>
            </div>
          ))}
        </div>
      </div>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-6 pb-28">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-lg font-extrabold text-[#1b2a4e]">
            {q ? 'Resultados' : 'Nossos produtos'}
          </h2>
          {total > 0 && <span className="text-xs text-slate-400">{total} itens</span>}
        </div>

        {erro && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm mb-4">{erro}</div>
        )}

        {produtos.length === 0 && !carregando && (
          <div className="text-center text-slate-400 py-20">
            {q ? `Nenhum produto encontrado para "${q}".` : 'Nenhum produto disponível no momento.'}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {produtos.map((p) => {
            const noCarrinho = carrinho[p.id]?.qtd ?? 0;
            return (
              <div
                key={p.id}
                className="group bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                <div className="aspect-square bg-white p-3 flex items-center justify-center overflow-hidden">
                  {p.imagem_url ? (
                    <img
                      src={p.imagem_url}
                      alt={p.descricao}
                      loading="lazy"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <span className="text-4xl text-slate-200">📦</span>
                  )}
                </div>
                <div className="px-3 pb-3 flex flex-col flex-1 border-t border-slate-100">
                  {p.marca && (
                    <div className="mt-2 text-[10px] font-bold text-[#c8941f] uppercase tracking-wide truncate">{p.marca}</div>
                  )}
                  <div className="text-[13px] text-slate-600 leading-snug line-clamp-2 min-h-[2.4rem] mt-0.5">{p.descricao}</div>
                  <div className="mt-2 text-lg font-extrabold text-[#1b2a4e]">{p.preco !== null ? brl(p.preco) : '—'}</div>
                  <div className="mt-2">
                    {noCarrinho === 0 ? (
                      <button
                        onClick={() => setQtd(p, 1)}
                        className={`w-full ${BTN_OURO} text-sm font-bold rounded-lg py-2 transition`}
                      >
                        Adicionar
                      </button>
                    ) : (
                      <div className="flex items-center justify-between bg-[#1b2a4e] rounded-lg text-white">
                        <button onClick={() => setQtd(p, noCarrinho - 1)} className="w-10 h-9 text-lg font-bold hover:text-[#e0b13c]">−</button>
                        <span className="font-bold">{noCarrinho}</span>
                        <button onClick={() => setQtd(p, noCarrinho + 1)} className="w-10 h-9 text-lg font-bold hover:text-[#e0b13c]">+</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {produtos.length < total && (
          <div className="text-center mt-7">
            <button
              onClick={() => { const next = pagina + 1; setPagina(next); carregar(q, next); }}
              disabled={carregando}
              className="bg-white border border-[#1b2a4e]/20 rounded-xl px-7 py-2.5 text-sm font-bold text-[#1b2a4e] hover:bg-[#1b2a4e] hover:text-white transition disabled:opacity-50"
            >
              {carregando ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
        {carregando && produtos.length === 0 && (
          <div className="text-center text-slate-400 py-20">Carregando produtos...</div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#16223f] text-slate-400 safe-pb">
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
                {itensCarrinho.map(({ produto, qtd }) => (
                  <div key={produto.id} className="flex gap-3 items-center">
                    <div className="w-14 h-14 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                      {produto.imagem_url ? (
                        <img src={produto.imagem_url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xl text-slate-300">📦</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2">{produto.descricao}</div>
                      <div className="text-sm font-bold text-[#1b2a4e]">{produto.preco !== null ? brl(produto.preco) : '—'}</div>
                    </div>
                    <div className="flex items-center gap-1 bg-[#1b2a4e] text-white rounded-lg shrink-0">
                      <button onClick={() => setQtd(produto, qtd - 1)} className="w-8 h-8 text-lg font-bold hover:text-[#e0b13c]">−</button>
                      <span className="font-bold w-5 text-center">{qtd}</span>
                      <button onClick={() => setQtd(produto, qtd + 1)} className="w-8 h-8 text-lg font-bold hover:text-[#e0b13c]">+</button>
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
