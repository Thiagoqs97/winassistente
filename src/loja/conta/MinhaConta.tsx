import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';
import { navegar } from '../nav';
import { useConta, type Cliente } from './ContaContext';
import {
  brl, BTN_OURO, SEGMENTOS_CLIENTE, Wordmark,
  IconArrowLeft, IconReceipt, IconUser, IconPin, IconLogout,
  IconPlus, IconTrash, IconCheck, IconSpinner, IconBox,
} from '../ui';

type Secao = 'pedidos' | 'avisos' | 'dados' | 'enderecos';

interface ItemPedido { descricao: string; marca: string | null; qtd: number; preco_unit: number; subtotal: number }
interface Pedido {
  numero: string;
  total: number;
  criado_em: string;
  statusCodigo: 'aguardando' | 'separacao' | 'concluido' | 'cancelado';
  statusLabel: string;
  itens: ItemPedido[];
}
interface Endereco {
  id: string;
  apelido: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  principal: boolean;
}

interface AvisoEstoque {
  id: string;
  produtoId: number;
  descricao: string;
  marca: string | null;
  imagemUrl: string | null;
  preco: number | null;
  criadoEm: string;
}

const STATUS_CLASSE: Record<Pedido['statusCodigo'], string> = {
  aguardando: 'bg-amber-50 text-amber-700 ring-amber-200',
  separacao: 'bg-blue-50 text-blue-700 ring-blue-200',
  concluido: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelado: 'bg-slate-100 text-slate-500 ring-slate-200',
};

function dataBR(iso: string): string {
  const [d, h] = iso.split('T');
  if (!d) return iso;
  const [ano, mes, dia] = d.split('-');
  return `${dia}/${mes}/${ano}${h ? ` · ${h.slice(0, 5)}` : ''}`;
}

const MENU: { id: Secao; label: string; Icon: (p: { className?: string }) => React.JSX.Element }[] = [
  { id: 'pedidos', label: 'Meus pedidos', Icon: IconReceipt },
  { id: 'avisos', label: 'Meus avisos', Icon: IconBox },
  { id: 'dados', label: 'Meus dados', Icon: IconUser },
  { id: 'enderecos', label: 'Meus endereços', Icon: IconPin },
];

export default function MinhaConta() {
  const { cliente, logout } = useConta();
  const [secao, setSecao] = useState<Secao>('pedidos');

  const sair = async () => {
    await logout();
    navegar('/loja');
  };

  if (!cliente) return null; // o LojaApp já garante o guard; isto é só pelo type-narrowing

  return (
    <div className="min-h-screen bg-[#f5f6f8] flex flex-col safe-pt safe-pb">
      <header className="bg-navy-800 text-white shadow-lg border-b border-gold-400/20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/loja" className="flex items-center gap-2.5">
            <img src="/logowin.png" alt="WIN Distribuidora" className="h-9 w-9 rounded-lg ring-1 ring-white/10" />
            <span className="hidden sm:block"><Wordmark /></span>
          </a>
          <button
            onClick={() => navegar('/loja')}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 px-3.5 py-2 text-sm font-semibold transition"
          >
            <IconArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Voltar ao catálogo</span><span className="sm:hidden">Catálogo</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 sm:py-8">
        <div className="mb-6">
          <p className="font-display uppercase tracking-[0.22em] text-[11px] text-gold-600 font-semibold">Minha conta</p>
          <h1 className="font-display uppercase tracking-tight text-2xl sm:text-3xl font-bold text-ink leading-none mt-1">
            Olá, {cliente.nome.split(' ')[0]}!
          </h1>
          {cliente.email && <p className="text-slate-500 text-sm mt-1">{cliente.email}</p>}
        </div>

        <div className="grid lg:grid-cols-[230px_1fr] gap-5">
          {/* Sidebar */}
          <nav className="bg-white rounded-2xl border border-slate-200 shadow-card p-2 h-max lg:sticky lg:top-6 flex lg:flex-col gap-1 overflow-x-auto no-scrollbar">
            {MENU.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setSecao(id)}
                className={`shrink-0 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition text-left ${
                  secao === id ? 'bg-navy-700 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-5 h-5 ${secao === id ? 'text-gold-400' : 'text-slate-400'}`} /> {label}
              </button>
            ))}
            <button
              onClick={sair}
              className="shrink-0 flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition text-left"
            >
              <IconLogout className="w-5 h-5" /> Sair
            </button>
          </nav>

          {/* Conteúdo */}
          <section className="min-w-0">
            {secao === 'pedidos' && <Pedidos />}
            {secao === 'avisos' && <AvisosEstoque />}
            {secao === 'dados' && <Dados />}
            {secao === 'enderecos' && <Enderecos />}
          </section>
        </div>
      </main>
    </div>
  );
}

// --- Meus pedidos ---

function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ pedidos: Pedido[] }>('/api/conta/pedidos')
      .then((r) => setPedidos(r.pedidos))
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Não consegui carregar seus pedidos.'));
  }, []);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!pedidos) return <CarregandoCard />;
  if (pedidos.length === 0) {
    return (
      <Vazio Icon={IconReceipt} titulo="Você ainda não tem pedidos" texto="Quando fizer um pedido pelo catálogo, ele aparece aqui com o status.">
        <button onClick={() => navegar('/loja')} className="bg-navy-700 hover:bg-navy-800 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition">
          Ir ao catálogo
        </button>
      </Vazio>
    );
  }

  return (
    <div className="space-y-4">
      {pedidos.map((p) => (
        <div key={p.numero} className="bg-white rounded-2xl border border-slate-200 shadow-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STATUS_CLASSE[p.statusCodigo]}`}>
                {p.statusLabel}
              </span>
              <p className="text-slate-400 text-xs mt-1.5">Pedido em {dataBR(p.criado_em)}</p>
            </div>
            <div className="text-right">
              <p className="font-display text-lg font-bold text-ink tabular-nums">{brl(p.total)}</p>
              <p className="font-display uppercase tracking-wide text-[11px] text-gold-600 font-semibold">{p.numero}</p>
            </div>
          </div>
          <ul className="px-5 py-3 divide-y divide-slate-50">
            {p.itens.map((it, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700 min-w-0">
                  <span className="font-semibold text-slate-500 tabular-nums">{it.qtd}×</span> {it.descricao}
                  {it.marca && <span className="text-slate-400"> · {it.marca}</span>}
                </span>
                <span className="text-slate-500 tabular-nums shrink-0">{brl(it.subtotal)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// --- Meus avisos ---

function AvisosEstoque() {
  const [avisos, setAvisos] = useState<AvisoEstoque[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<Record<number, boolean>>({});

  const carregar = useCallback(() => {
    setErro(null);
    apiFetch<{ avisos: AvisoEstoque[] }>('/api/conta/avisos')
      .then((r) => setAvisos(r.avisos))
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Não consegui carregar seus avisos.'));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const cancelar = async (produtoId: number) => {
    setCancelando((s) => ({ ...s, [produtoId]: true }));
    try {
      await apiFetch(`/api/loja/produtos/${produtoId}/avise-me`, { method: 'DELETE' });
      setAvisos((lista) => (lista ?? []).filter((a) => a.produtoId !== produtoId));
    } catch (e: any) {
      setErro(e instanceof ApiError ? e.message : 'Não consegui cancelar o aviso.');
    } finally {
      setCancelando((s) => ({ ...s, [produtoId]: false }));
    }
  };

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!avisos) return <CarregandoCard />;
  if (avisos.length === 0) {
    return (
      <Vazio Icon={IconBox} titulo="Nenhum aviso ativo" texto="Quando um produto estiver sem estoque, toque em Avise-me no catálogo.">
        <button onClick={() => navegar('/loja')} className="bg-navy-700 hover:bg-navy-800 text-white font-semibold rounded-xl px-5 py-2.5 text-sm transition">
          Ver catálogo
        </button>
      </Vazio>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="font-display uppercase tracking-tight text-xl font-bold text-ink">Meus avisos</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {avisos.map((a) => (
          <div key={a.id} className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 flex gap-3">
            <div className="w-16 h-16 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
              {a.imagemUrl ? <img src={a.imagemUrl} alt="" className="w-full h-full object-contain" /> : <IconBox className="w-7 h-7 text-slate-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 line-clamp-2">{a.descricao}</p>
              {a.marca && <p className="text-xs text-gold-600 font-semibold uppercase tracking-wide mt-0.5">{a.marca}</p>}
              <p className="text-xs text-slate-400 mt-1">Criado em {dataBR(a.criadoEm)}</p>
              {a.preco !== null && <p className="font-display font-bold text-ink mt-1">{brl(a.preco)}</p>}
              <button
                onClick={() => cancelar(a.produtoId)}
                disabled={cancelando[a.produtoId]}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-60"
              >
                {cancelando[a.produtoId] ? <IconSpinner className="w-4 h-4" /> : <IconTrash className="w-4 h-4" />}
                Cancelar aviso
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Meus dados ---

function Dados() {
  const { cliente, setCliente } = useConta();
  const [nome, setNome] = useState(cliente?.nome ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [telefone, setTelefone] = useState(cliente?.celular ?? '');
  const [cpfCnpj, setCpfCnpj] = useState(cliente?.cpf_cnpj ?? '');
  const [segmento, setSegmento] = useState(cliente?.segmento ?? '');
  const [nascimento, setNascimento] = useState(cliente?.data_nascimento ?? '');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setSalvando(true);
    try {
      const r = await apiFetch<{ cliente: Cliente }>('/api/conta/perfil', {
        method: 'PATCH',
        body: JSON.stringify({
          nome,
          email,
          telefone,
          cpf_cnpj: cpfCnpj,
          segmento,
          data_nascimento: nascimento || null,
        }),
      });
      setCliente(r.cliente);
      setMsg({ tom: 'ok', texto: 'Dados atualizados!' });
    } catch (err: any) {
      setMsg({ tom: 'erro', texto: err instanceof ApiError ? err.message : 'Não consegui salvar.' });
    } finally {
      setSalvando(false);
    }
  };

  const campo = 'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition';
  const rotulo = 'block text-sm font-semibold text-ink mb-1.5';

  return (
    <form onSubmit={salvar} className="bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-7 space-y-4 max-w-2xl">
      <h2 className="font-display uppercase tracking-tight text-xl font-bold text-ink">Meus dados</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="sm:col-span-2"><span className={rotulo}>Nome completo</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} /></label>
        <label><span className={rotulo}>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} /></label>
        <label><span className={rotulo}>Celular</span>
          <input value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" className={campo} /></label>
        <label><span className={rotulo}>CPF / CNPJ</span>
          <input value={cpfCnpj} onChange={(e) => setCpfCnpj(e.target.value)} className={campo} /></label>
        <label><span className={rotulo}>Tipo de estabelecimento</span>
          <select value={segmento} onChange={(e) => setSegmento(e.target.value)} className={campo}>
            <option value="">Selecione</option>
            {SEGMENTOS_CLIENTE.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label><span className={rotulo}>Nascimento</span>
          <input type="date" value={nascimento} onChange={(e) => setNascimento(e.target.value)} className={campo} /></label>
      </div>

      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}

      <button type="submit" disabled={salvando} className={`${BTN_OURO} font-bold rounded-xl px-6 py-3 transition-all active:scale-[0.99] disabled:opacity-60 inline-flex items-center gap-2`}>
        {salvando && <IconSpinner className="w-5 h-5" />} Salvar alterações
      </button>
    </form>
  );
}

// --- Meus endereços ---

const ENDERECO_VAZIO: Omit<Endereco, 'id' | 'principal'> & { principal: boolean } = {
  apelido: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', principal: false,
};

function Enderecos() {
  const [lista, setLista] = useState<Endereco[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Endereco | null>(null); // null = nenhum; id vazio = novo

  const carregar = useCallback(() => {
    apiFetch<{ enderecos: Endereco[] }>('/api/conta/enderecos')
      .then((r) => setLista(r.enderecos))
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Não consegui carregar seus endereços.'));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const remover = async (id: string) => {
    await apiFetch(`/api/conta/enderecos/${id}`, { method: 'DELETE' }).catch(() => {});
    carregar();
  };

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!lista) return <CarregandoCard />;

  if (editando) {
    return (
      <EnderecoForm
        inicial={editando}
        aoSalvar={() => { setEditando(null); carregar(); }}
        aoCancelar={() => setEditando(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display uppercase tracking-tight text-xl font-bold text-ink">Meus endereços</h2>
        <button
          onClick={() => setEditando({ id: '', ...ENDERECO_VAZIO } as Endereco)}
          className="inline-flex items-center gap-2 bg-navy-700 hover:bg-navy-800 text-white font-semibold rounded-xl px-4 py-2 text-sm transition"
        >
          <IconPlus className="w-4 h-4" /> Adicionar
        </button>
      </div>

      {lista.length === 0 ? (
        <Vazio Icon={IconPin} titulo="Nenhum endereço salvo" texto="Cadastre um endereço de entrega pra agilizar seus pedidos." />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {lista.map((e) => (
            <div key={e.id} className="bg-white rounded-2xl border border-slate-200 shadow-card p-4 relative">
              {e.principal && (
                <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-gold-200 text-navy-900 ring-1 ring-gold-300 px-2 py-0.5 text-[11px] font-semibold">
                  <IconCheck className="w-3 h-3" /> Principal
                </span>
              )}
              {e.apelido && <p className="font-display uppercase tracking-wide text-xs text-gold-600 font-semibold">{e.apelido}</p>}
              <p className="text-slate-800 font-medium mt-0.5">{[e.logradouro, e.numero].filter(Boolean).join(', ') || '—'}</p>
              <p className="text-slate-500 text-sm">{[e.complemento, e.bairro].filter(Boolean).join(' · ')}</p>
              <p className="text-slate-500 text-sm">{[[e.cidade, e.uf].filter(Boolean).join('/'), e.cep].filter(Boolean).join(' · ')}</p>
              <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                <button onClick={() => setEditando(e)} className="text-sm font-semibold text-navy-700 hover:text-gold-600 transition">Editar</button>
                <button onClick={() => remover(e.id)} className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-red-600 hover:text-red-700 transition">
                  <IconTrash className="w-4 h-4" /> Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnderecoForm({ inicial, aoSalvar, aoCancelar }: { inicial: Endereco; aoSalvar: () => void; aoCancelar: () => void }) {
  const [f, setF] = useState<Endereco>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const novo = !inicial.id;

  const set = (k: keyof Endereco, v: any) => setF((p) => ({ ...p, [k]: v }));

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const corpo = JSON.stringify({
        apelido: f.apelido, cep: f.cep, logradouro: f.logradouro, numero: f.numero,
        complemento: f.complemento, bairro: f.bairro, cidade: f.cidade, uf: f.uf, principal: f.principal,
      });
      if (novo) await apiFetch('/api/conta/enderecos', { method: 'POST', body: corpo });
      else await apiFetch(`/api/conta/enderecos/${f.id}`, { method: 'PATCH', body: corpo });
      aoSalvar();
    } catch (err: any) {
      setErro(err instanceof ApiError ? err.message : 'Não consegui salvar o endereço.');
    } finally {
      setSalvando(false);
    }
  };

  const campo = 'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition';
  const rotulo = 'block text-sm font-semibold text-ink mb-1.5';

  return (
    <form onSubmit={salvar} className="bg-white rounded-2xl border border-slate-200 shadow-card p-5 sm:p-7 space-y-4 max-w-2xl">
      <h2 className="font-display uppercase tracking-tight text-xl font-bold text-ink">{novo ? 'Novo endereço' : 'Editar endereço'}</h2>
      <div className="grid sm:grid-cols-6 gap-4">
        <label className="sm:col-span-3"><span className={rotulo}>Apelido (casa, trabalho...)</span>
          <input value={f.apelido ?? ''} onChange={(e) => set('apelido', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-3"><span className={rotulo}>CEP</span>
          <input value={f.cep ?? ''} onChange={(e) => set('cep', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-4"><span className={rotulo}>Endereço (rua/avenida)</span>
          <input value={f.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-2"><span className={rotulo}>Número</span>
          <input value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-3"><span className={rotulo}>Complemento</span>
          <input value={f.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-3"><span className={rotulo}>Bairro</span>
          <input value={f.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-4"><span className={rotulo}>Cidade</span>
          <input value={f.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} className={campo} /></label>
        <label className="sm:col-span-2"><span className={rotulo}>UF</span>
          <input value={f.uf ?? ''} onChange={(e) => set('uf', e.target.value.toUpperCase().slice(0, 2))} className={campo} maxLength={2} /></label>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
        <input type="checkbox" checked={f.principal} onChange={(e) => set('principal', e.target.checked)} className="w-4 h-4 rounded accent-gold-500" />
        Usar como endereço principal
      </label>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="flex gap-3">
        <button type="submit" disabled={salvando} className={`${BTN_OURO} font-bold rounded-xl px-6 py-3 transition-all active:scale-[0.99] disabled:opacity-60 inline-flex items-center gap-2`}>
          {salvando && <IconSpinner className="w-5 h-5" />} Salvar
        </button>
        <button type="button" onClick={aoCancelar} className="rounded-xl px-6 py-3 font-semibold text-slate-600 hover:bg-slate-100 transition">Cancelar</button>
      </div>
    </form>
  );
}

// --- Primitivos compartilhados ---

function Aviso({ tom, children }: { tom: 'ok' | 'erro'; children: React.ReactNode }) {
  const c = tom === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100';
  return <div className={`rounded-xl p-3 text-sm border ${c}`}>{children}</div>;
}

function CarregandoCard() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-10 flex items-center justify-center text-slate-400 gap-3">
      <IconSpinner className="w-6 h-6" /> Carregando...
    </div>
  );
}

function Vazio({ Icon, titulo, texto, children }: { Icon: (p: { className?: string }) => React.JSX.Element; titulo: string; texto: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-10 text-center">
      <Icon className="w-12 h-12 mx-auto mb-3 text-slate-200" />
      <p className="font-display uppercase tracking-tight text-lg font-bold text-ink">{titulo}</p>
      <p className="text-slate-500 text-sm mt-1 mb-4 max-w-sm mx-auto">{texto}</p>
      {children}
    </div>
  );
}
