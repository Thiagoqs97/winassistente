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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl mx-auto mb-4">
            ✓
          </div>
          <h1 className="text-xl font-bold text-slate-800">Pedido recebido!</h1>
          <p className="text-slate-500 mt-2">
            Seu pedido <span className="font-semibold text-slate-700">{pedido.numero}</span> foi registrado.
            Nossa equipe vai entrar em contato pra confirmar.
          </p>
          <div className="mt-4 text-left bg-slate-50 rounded-xl p-4 text-sm">
            <div className="flex justify-between font-semibold text-slate-700">
              <span>Total</span>
              <span>{brl(pedido.total)}</span>
            </div>
            <p className="text-slate-400 mt-1">{pedido.itens.length} item(ns)</p>
          </div>
          <button
            onClick={novoPedido}
            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition"
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 safe-pt">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="font-extrabold text-blue-700 text-lg tracking-tight">WIN Distribuidora</div>
          <div className="flex-1" />
          <button
            onClick={() => setCarrinhoAberto(true)}
            className="relative rounded-xl bg-slate-100 hover:bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition"
          >
            🛒 Carrinho
            {totalItens > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-xs rounded-full min-w-5 h-5 px-1 flex items-center justify-center font-bold">
                {totalItens}
              </span>
            )}
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar produto ou marca..."
            className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 pb-28">
        {erro && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm mb-4">{erro}</div>
        )}

        {produtos.length === 0 && !carregando && (
          <div className="text-center text-slate-400 py-20">
            {q ? `Nenhum produto encontrado para "${q}".` : 'Nenhum produto disponível no momento.'}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {produtos.map((p) => {
            const noCarrinho = carrinho[p.id]?.qtd ?? 0;
            return (
              <div key={p.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                  {p.imagem_url ? (
                    <img src={p.imagem_url} alt={p.descricao} loading="lazy" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-4xl text-slate-300">📦</span>
                  )}
                </div>
                <div className="p-3 flex flex-col flex-1">
                  {p.marca && <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide truncate">{p.marca}</div>}
                  <div className="text-sm text-slate-700 leading-snug line-clamp-2 min-h-[2.5rem]">{p.descricao}</div>
                  <div className="mt-2 font-bold text-slate-800">{p.preco !== null ? brl(p.preco) : '—'}</div>
                  <div className="mt-2">
                    {noCarrinho === 0 ? (
                      <button
                        onClick={() => setQtd(p, 1)}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg py-2 transition"
                      >
                        Adicionar
                      </button>
                    ) : (
                      <div className="flex items-center justify-between bg-slate-100 rounded-lg">
                        <button onClick={() => setQtd(p, noCarrinho - 1)} className="w-9 h-9 text-lg font-bold text-slate-600">−</button>
                        <span className="font-semibold text-slate-800">{noCarrinho}</span>
                        <button onClick={() => setQtd(p, noCarrinho + 1)} className="w-9 h-9 text-lg font-bold text-slate-600">+</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {produtos.length < total && (
          <div className="text-center mt-6">
            <button
              onClick={() => { const next = pagina + 1; setPagina(next); carregar(q, next); }}
              disabled={carregando}
              className="bg-white border border-slate-300 rounded-xl px-6 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {carregando ? 'Carregando...' : 'Carregar mais'}
            </button>
          </div>
        )}
        {carregando && produtos.length === 0 && (
          <div className="text-center text-slate-400 py-20">Carregando produtos...</div>
        )}
      </main>

      {/* Barra inferior fixa: atalho pro carrinho quando tem item */}
      {totalItens > 0 && !carrinhoAberto && (
        <button
          onClick={() => setCarrinhoAberto(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg px-6 py-3 font-semibold flex items-center gap-3 safe-pb"
        >
          <span>Ver carrinho ({totalItens})</span>
          <span className="opacity-80">{brl(totalCarrinho)}</span>
        </button>
      )}

      {/* Drawer do carrinho / checkout */}
      {carrinhoAberto && (
        <div className="fixed inset-0 z-30 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} />
          <div className="relative bg-white w-full max-w-md h-full shadow-xl flex flex-col safe-pt safe-pb">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-800">
                {vista === 'checkout' ? 'Seus dados' : 'Seu pedido'}
              </h2>
              <button onClick={() => { setCarrinhoAberto(false); setVista('catalogo'); }} className="text-slate-400 text-2xl leading-none">×</button>
            </div>

            {itensCarrinho.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-400">Carrinho vazio.</div>
            ) : vista === 'checkout' ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">Nome</span>
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Seu nome"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-600">WhatsApp / Telefone</span>
                  <input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    inputMode="tel"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="(86) 99999-9999"
                  />
                </label>
                {erroCheckout && <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">{erroCheckout}</div>}
                <div className="text-sm text-slate-500">
                  {totalItens} item(ns) · <span className="font-semibold text-slate-700">{brl(totalCarrinho)}</span>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {itensCarrinho.map(({ produto, qtd }) => (
                  <div key={produto.id} className="flex gap-3 items-center">
                    <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                      {produto.imagem_url ? (
                        <img src={produto.imagem_url} alt="" className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-xl text-slate-300">📦</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-700 line-clamp-2">{produto.descricao}</div>
                      <div className="text-sm font-semibold text-slate-800">{produto.preco !== null ? brl(produto.preco) : '—'}</div>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg shrink-0">
                      <button onClick={() => setQtd(produto, qtd - 1)} className="w-8 h-8 text-lg font-bold text-slate-600">−</button>
                      <span className="font-semibold text-slate-800 w-5 text-center">{qtd}</span>
                      <button onClick={() => setQtd(produto, qtd + 1)} className="w-8 h-8 text-lg font-bold text-slate-600">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {itensCarrinho.length > 0 && (
              <div className="border-t border-slate-200 p-5 space-y-3">
                <div className="flex justify-between font-bold text-slate-800">
                  <span>Total</span>
                  <span>{brl(totalCarrinho)}</span>
                </div>
                {vista === 'checkout' ? (
                  <button
                    onClick={enviarPedido}
                    disabled={enviando}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl py-3 transition disabled:opacity-60"
                  >
                    {enviando ? 'Enviando...' : 'Enviar pedido'}
                  </button>
                ) : (
                  <button
                    onClick={() => setVista('checkout')}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-3 transition"
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
