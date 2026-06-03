import React, { useEffect, useMemo, useState } from 'react';
import { PackageOpen, MessageSquare, Settings, Upload, History, FileText, ShoppingBag, Users, UserCog, LogOut, LayoutDashboard, TrendingUp, TrendingDown, DollarSign, Target, Receipt, AlertTriangle, Sparkles, Menu, X } from 'lucide-react';
import { cn } from './lib/utils';
import { useAuth } from './auth/AuthContext';
import { LoginScreen } from './auth/LoginScreen';
import { hasAnyPermission, PERMISSION_LABELS, PERMISSIONS, type Permission } from './lib/permissions';
import { InstallPrompt } from './InstallPrompt';
import { ErrorBoundary } from './ErrorBoundary';

type TabKey = 'dashboard' | 'import' | 'products' | 'settings' | 'history' | 'orcamentos' | 'vendas' | 'clientes' | 'users';

// Cada tab declara as permissões que dão acesso (admin sempre vê tudo).
// 'users' é admin-only — a checagem real é feita pelo role, não pela permissão.
const TAB_PERMS: Record<TabKey, Permission[]> = {
  dashboard: ['dashboard.view'],
  import: ['products.import'],
  products: ['products.view'],
  clientes: ['clientes.view'],
  history: ['historico.view'],
  orcamentos: ['orcamentos.view'],
  vendas: ['vendas.view'],
  settings: ['config.view'],
  users: ['users.manage'],
};

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] text-slate-400 flex items-center justify-center">
        Carregando…
      </div>
    );
  }

  if (!user) return (
    <>
      <LoginScreen />
      <InstallPrompt />
    </>
  );

  return (
    <>
      <ProtectedApp />
      <InstallPrompt />
    </>
  );
}

function ProtectedApp() {
  const { user, logout } = useAuth();
  const u = user!;

  // Determina as tabs visíveis para este usuário e define a inicial.
  const visibleTabs = useMemo<TabKey[]>(() => {
    const all: TabKey[] = ['dashboard', 'import', 'products', 'clientes', 'history', 'orcamentos', 'vendas', 'settings', 'users'];
    return all.filter(t => {
      if (t === 'users') return u.role === 'admin';
      return hasAnyPermission(u, ...TAB_PERMS[t]);
    });
  }, [u]);

  const [activeTab, setActiveTab] = useState<TabKey>(() => visibleTabs[0] || 'orcamentos');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Se o user perder acesso à tab atual (em refresh), reposiciona.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab) && visibleTabs.length > 0) {
      setActiveTab(visibleTabs[0]);
    }
  }, [visibleTabs, activeTab]);

  // Trava scroll do body quando o drawer mobile está aberto.
  useEffect(() => {
    if (sidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [sidebarOpen]);

  const goTo = (t: TabKey) => { setActiveTab(t); setSidebarOpen(false); };

  if (visibleTabs.length === 0) {
    return (
      <div className="min-h-screen bg-[#020617] text-slate-200 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-lg font-medium">Você não tem acesso a nenhuma área.</p>
          <p className="text-slate-400 mt-2 text-sm">Peça ao administrador para te dar permissão.</p>
          <button onClick={logout} className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm">Sair</button>
        </div>
      </div>
    );
  }

  const sidebarLinks = (
    <>
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold px-2">Navegação</p>
      {visibleTabs.includes('dashboard') && <SidebarItem icon={<LayoutDashboard size={16} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => goTo('dashboard')} />}
      {visibleTabs.includes('import') && <SidebarItem icon={<Upload size={16} />} label="Importação" active={activeTab === 'import'} onClick={() => goTo('import')} />}
      {visibleTabs.includes('products') && <SidebarItem icon={<PackageOpen size={16} />} label="Produtos" active={activeTab === 'products'} onClick={() => goTo('products')} />}
      {visibleTabs.includes('clientes') && <SidebarItem icon={<Users size={16} />} label="Clientes" active={activeTab === 'clientes'} onClick={() => goTo('clientes')} />}
      {visibleTabs.includes('history') && <SidebarItem icon={<History size={16} />} label="Histórico" active={activeTab === 'history'} onClick={() => goTo('history')} />}
      {visibleTabs.includes('orcamentos') && <SidebarItem icon={<FileText size={16} />} label="Orçamentos" active={activeTab === 'orcamentos'} onClick={() => goTo('orcamentos')} />}
      {visibleTabs.includes('vendas') && <SidebarItem icon={<ShoppingBag size={16} />} label="Vendas" active={activeTab === 'vendas'} onClick={() => goTo('vendas')} />}
      {visibleTabs.includes('settings') && <SidebarItem icon={<Settings size={16} />} label="Configurações" active={activeTab === 'settings'} onClick={() => goTo('settings')} />}
      {visibleTabs.includes('users') && <SidebarItem icon={<UserCog size={16} />} label="Usuários" active={activeTab === 'users'} onClick={() => goTo('users')} />}
    </>
  );

  return (
    <div className="flex flex-col h-[100dvh] bg-[#020617] text-slate-200 font-sans overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-5%] w-[400px] h-[400px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none hidden sm:block"></div>
      <div className="absolute bottom-[10%] right-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none hidden sm:block"></div>
      <div className="absolute top-[20%] right-[15%] w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none hidden lg:block"></div>

      <nav className="relative z-30 border-b border-white/10 backdrop-blur-md bg-white/5 safe-pt safe-pl safe-pr">
        <div className="h-14 sm:h-16 flex items-center justify-between px-3 sm:px-6 lg:px-8 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
            >
              <Menu size={18} />
            </button>
            <img src="/logowin.png" alt="WIN Distribuidora" className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg shadow-lg shadow-indigo-500/20" />
          </div>
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-medium text-green-400 uppercase tracking-widest">Sistema Online</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 md:pl-4 md:border-l md:border-white/10 min-w-0">
              <div className="text-right hidden sm:block min-w-0">
                <p className="text-sm font-medium text-white leading-tight truncate max-w-[160px]">{u.nome}</p>
                <p className="text-[10px] uppercase tracking-widest text-slate-500">{u.role === 'admin' ? 'Administrador' : 'Vendedor'}</p>
              </div>
              <button
                onClick={logout}
                title="Sair"
                aria-label="Sair"
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-rose-500/20 hover:text-rose-300 border border-white/10 hover:border-rose-500/30 text-slate-400 transition-colors flex-shrink-0"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 relative z-10 overflow-hidden">
        {/* Sidebar — fixa em desktop, drawer em mobile/tablet */}
        <aside className="hidden lg:flex w-64 border-r border-white/10 backdrop-blur-md bg-white/5 p-6 flex-col gap-8 safe-pl">
          <div className="flex flex-col gap-2">
            {sidebarLinks}
          </div>
          <div className="mt-auto p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
            <p className="text-xs text-indigo-300 font-semibold mb-1">Agente IA v2.0</p>
            <p className="text-[10px] text-indigo-400/70">Fuzzy Search · Webhook · Whisper</p>
          </div>
        </aside>

        {/* Drawer mobile */}
        {sidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-40">
            <button
              type="button"
              aria-label="Fechar menu"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <aside className="absolute top-0 left-0 h-full w-72 max-w-[85vw] bg-slate-950/95 backdrop-blur-xl border-r border-white/10 p-5 flex flex-col gap-6 safe-pt safe-pl shadow-2xl animate-in slide-in-from-left-2 duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <img src="/logowin.png" alt="WIN" className="h-8 w-8 rounded-lg" />
                  <span className="text-sm font-bold text-white">Menu</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Fechar"
                  className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex flex-col gap-2 overflow-auto -mx-1 px-1 flex-1">
                {sidebarLinks}
              </div>
              <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
                <p className="text-xs text-indigo-300 font-semibold mb-1">Agente IA v2.0</p>
                <p className="text-[10px] text-indigo-400/70">Fuzzy Search · Webhook · Whisper</p>
              </div>
            </aside>
          </div>
        )}

        <main className="flex-1 overflow-auto px-3 py-4 sm:px-6 sm:py-6 lg:p-8 flex flex-col gap-6 lg:gap-8 safe-pb safe-pl safe-pr">
          <div className="max-w-5xl mx-auto w-full">
            <ErrorBoundary key={activeTab}>
              {activeTab === 'dashboard' && <DashboardTab />}
              {activeTab === 'import' && <ImportTab />}
              {activeTab === 'products' && <ProductsTab />}
              {activeTab === 'clientes' && <ClientesTab />}
              {activeTab === 'history' && <HistoryTab />}
              {activeTab === 'orcamentos' && <OrcamentosTab mode="orcamentos" />}
              {activeTab === 'vendas' && <OrcamentosTab mode="vendas" />}
              {activeTab === 'settings' && <SettingsTab />}
              {activeTab === 'users' && <UsersTab currentUserId={u.id} />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors text-left',
        active ? 'bg-white/10 border border-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white border border-transparent'
      )}
    >
      {React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: 'w-4 h-4' })}
      <span className="text-sm font-medium">{label}</span>
    </button>
  );
}

// --- TABS ---

function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      // Converte arquivo para base64 e envia como JSON — necessário para Vercel serverless
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // remove o prefixo "data:...;base64,"
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/upload-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileData: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload falhou');
      setMessage(data.message || 'Upload concluído com sucesso!');
      setFile(null);
    } catch (err: any) {
      setMessage(`Erro: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Importação de Estoque</h2>
        <p className="text-slate-400 mt-2">Faça upload da planilha do Winthor. O sistema extrai automaticamente as colunas cruciais.</p>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-8 shadow-sm">
        <div className="border border-dashed border-white/20 rounded-xl p-6 sm:p-12 text-center hover:bg-white/5 transition-colors">
          <Upload className="mx-auto h-12 w-12 text-slate-500" />
          <p className="mt-4 text-sm text-slate-400">Arraste um arquivo .xlsx ou clique para selecionar.</p>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="file-upload" />
          <label htmlFor="file-upload" className="mt-4 inline-flex items-center px-4 py-2 border border-white/10 text-sm font-medium rounded-xl text-white bg-white/10 hover:bg-white/20 cursor-pointer transition-colors">
            Selecionar Arquivo
          </label>
        </div>

        {file && (
          <div className="mt-6 flex items-center justify-between bg-white/5 p-4 rounded-xl border border-white/10">
            <span className="text-sm font-medium text-slate-300 truncate max-w-xs">{file.name}</span>
            <button onClick={handleUpload} disabled={uploading} className="bg-indigo-600/80 hover:bg-indigo-600 text-white px-5 py-2 rounded-xl disabled:opacity-50 text-sm font-bold transition-colors shadow-lg shadow-indigo-900/20">
              {uploading ? 'Processando...' : 'Importar Base'}
            </button>
          </div>
        )}

        {message && (
          <div className={cn('mt-6 p-4 rounded-xl text-sm font-medium border', message.startsWith('Erro') ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20')}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductsTab() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [marca, setMarca] = useState<string>('');
  const [categoria, setCategoria] = useState<string>('');
  const [statusFiltro, setStatusFiltro] = useState<'todos' | 'ativo' | 'inativo'>('todos');

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggleAtivo = async (id: number) => {
    try {
      await fetch(`/api/products/${id}/toggle`, { method: 'PUT' });
      setProducts(products.map(p => p.id === id ? { ...p, ativo: !p.ativo } : p));
    } catch (e) { console.error(e); }
  };

  const marcas = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.marca) set.add(String(p.marca));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.categoria) set.add(String(p.categoria));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [products]);

  const normalizar = (s: any) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const filtered = useMemo(() => {
    const q = normalizar(query.trim());
    return products.filter(p => {
      if (statusFiltro === 'ativo' && !p.ativo) return false;
      if (statusFiltro === 'inativo' && p.ativo) return false;
      if (marca && p.marca !== marca) return false;
      if (categoria && p.categoria !== categoria) return false;
      if (q) {
        const haystack = [p.codigo, p.descricao, p.codigo_barras, p.marca, p.categoria, p.embalagem]
          .map(normalizar).join(' ');
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [products, query, marca, categoria, statusFiltro]);

  const limparFiltros = () => { setQuery(''); setMarca(''); setCategoria(''); setStatusFiltro('todos'); };
  const algumFiltroAtivo = query !== '' || marca !== '' || categoria !== '' || statusFiltro !== 'todos';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Gestão de Produtos</h2>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Consulte e edite a visibilidade dos produtos no agente de IA.</p>
        </div>
        <button onClick={fetchProducts} className="px-4 sm:px-6 py-2.5 sm:py-3 bg-white/10 text-white font-bold rounded-xl border border-white/10 hover:bg-white/20 transition-colors text-sm self-start">
          Atualizar Lista
        </button>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="lg:col-span-2">
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Buscar</label>
          <input
            type="text"
            placeholder="Descrição, código, código de barras..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-200 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Marca</label>
          <select
            value={marca}
            onChange={(e) => setMarca(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-200 text-sm"
          >
            <option value="">Todas</option>
            {marcas.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1.5">Categoria</label>
          <select
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
            className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-200 text-sm"
          >
            <option value="">Todas</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mr-1">Status:</span>
          {(['todos', 'ativo', 'inativo'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFiltro(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                statusFiltro === s
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
              )}
            >
              {s === 'todos' ? 'Todos' : s === 'ativo' ? 'Ativos' : 'Inativos'}
            </button>
          ))}
          {algumFiltroAtivo && (
            <button onClick={limparFiltros} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10 transition-colors">
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[60vh] lg:h-[55vh]">
        <div className="p-4 sm:p-6 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-bold text-white text-sm sm:text-base">Estoque Sincronizado</h3>
          <span className="text-xs text-slate-400">
            {filtered.length === products.length
              ? `${products.length} produtos`
              : `${filtered.length} de ${products.length} produtos`}
          </span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-left min-w-[640px]">
            <thead className="bg-slate-950/50 sticky top-0 z-10 backdrop-blur-md">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Código</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Descrição</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden md:table-cell">Marca</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden lg:table-cell">Categoria</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden lg:table-cell">Embalagem</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden xl:table-cell">Cód. Barras</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Preço</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum produto. Importe uma planilha.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum produto bate com os filtros.</td></tr>
              ) : filtered.map(p => (
                <tr key={p.id} className={cn('border-t border-white/5 transition-colors hover:bg-white/5', !p.ativo && 'opacity-50')}>
                  <td className="px-3 sm:px-4 py-3 text-xs font-mono text-slate-500">{p.codigo}</td>
                  <td className="px-3 sm:px-4 py-3 text-sm text-slate-200 max-w-[180px] sm:max-w-xs truncate">{p.descricao}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden md:table-cell">{p.marca || '--'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">{p.categoria || '--'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">{p.embalagem || '--'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs font-mono text-slate-500 hidden xl:table-cell">{p.codigo_barras || '--'}</td>
                  <td className="px-3 sm:px-4 py-3 text-sm font-semibold text-slate-200 whitespace-nowrap">{p.preco_venda ? `R$ ${Number(p.preco_venda).toFixed(2)}` : '--'}</td>
                  <td className="px-3 sm:px-4 py-3 text-center">
                    <button onClick={() => toggleAtivo(p.id)} className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold transition-colors', p.ativo ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400')}>
                      {p.ativo ? 'ATIVO' : 'INATIVO'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HistoryTab() {
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [selectedVendedor, setSelectedVendedor] = useState<any | null>(null);
  const [sessoes, setSessoes] = useState<any[]>([]);
  const [selectedSessao, setSelectedSessao] = useState<any | null>(null);
  const [mensagens, setMensagens] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/vendedores')
      .then(r => r.json())
      .then(data => setVendedores(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadSessoes = async (vendedor: any) => {
    setSelectedVendedor(vendedor);
    setSelectedSessao(null);
    setMensagens([]);
    const res = await fetch(`/api/vendedores/${vendedor.id}/sessoes`);
    const data = await res.json();
    setSessoes(Array.isArray(data) ? data : []);
  };

  const loadMensagens = async (sessao: any) => {
    setSelectedSessao(sessao);
    const res = await fetch(`/api/sessoes/${sessao.id}/mensagens`);
    const data = await res.json();
    setMensagens(Array.isArray(data) ? data : []);
  };

  const statusBadge = (status: string) => {
    if (status === 'ativa') return 'bg-green-500/20 text-green-400';
    if (status === 'orcamento_gerado') return 'bg-indigo-500/20 text-indigo-400';
    return 'bg-slate-500/20 text-slate-400';
  };

  const mediaIcon: Record<string, string> = { audio: '🎤', imagem: '🖼️', pdf: '📄', planilha: '📊', texto: '💬' };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Histórico de Conversas</h2>
        <p className="text-slate-400 mt-2 text-sm sm:text-base">Visualize sessões e mensagens de cada vendedor.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:h-[68vh]">
        {/* Vendedores */}
        <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[40vh] md:h-auto">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-bold text-white text-sm">Vendedores</h3>
            <span className="text-xs text-slate-500">{vendedores.length}</span>
          </div>
          <div className="overflow-auto flex-1">
            {loading ? (
              <p className="p-4 text-slate-500 text-sm">Carregando...</p>
            ) : vendedores.length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">Nenhum vendedor ainda.</p>
            ) : vendedores.map(v => (
              <button key={v.id} onClick={() => loadSessoes(v)} className={cn('w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-colors', selectedVendedor?.id === v.id && 'bg-indigo-500/10 border-l-2 border-l-indigo-500')}>
                <p className="text-sm font-medium text-white truncate">{v.nome || 'Vendedor'}</p>
                <p className="text-xs text-slate-400 font-mono">{v.numero_whatsapp}</p>
                <p className="text-xs text-slate-500 mt-1">{v.total_sessoes} sessão(ões)</p>
              </button>
            ))}
          </div>
        </div>

        {/* Sessões */}
        <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[40vh] md:h-auto">
          <div className="p-4 border-b border-white/10">
            <h3 className="font-bold text-white text-sm truncate">Sessões{selectedVendedor ? ` — ${selectedVendedor.nome || selectedVendedor.numero_whatsapp}` : ''}</h3>
          </div>
          <div className="overflow-auto flex-1">
            {!selectedVendedor ? (
              <p className="p-4 text-slate-500 text-sm">Selecione um vendedor.</p>
            ) : sessoes.length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">Sem sessões registradas.</p>
            ) : sessoes.map(s => (
              <button key={s.id} onClick={() => loadMensagens(s)} className={cn('w-full text-left p-4 border-b border-white/5 hover:bg-white/5 transition-colors', selectedSessao?.id === s.id && 'bg-indigo-500/10 border-l-2 border-l-indigo-500')}>
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded', statusBadge(s.status))}>{s.status}</span>
                  <span className="text-xs text-slate-500">{s.total_mensagens} msg(s)</span>
                </div>
                <p className="text-xs text-slate-400">{new Date(s.iniciada_em).toLocaleString('pt-BR')}</p>
                {s.encerrada_em && <p className="text-xs text-slate-500">Encerrada: {new Date(s.encerrada_em).toLocaleString('pt-BR')}</p>}
              </button>
            ))}
          </div>
        </div>

        {/* Mensagens */}
        <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[50vh] md:h-auto">
          <div className="p-4 border-b border-white/10">
            <h3 className="font-bold text-white text-sm">Mensagens</h3>
          </div>
          <div className="overflow-auto flex-1 p-4 space-y-3">
            {!selectedSessao ? (
              <p className="text-slate-500 text-sm">Selecione uma sessão.</p>
            ) : mensagens.length === 0 ? (
              <p className="text-slate-500 text-sm">Sem mensagens.</p>
            ) : mensagens.map(m => (
              <div key={m.id} className={cn('p-3 rounded-xl', m.papel === 'user' ? 'bg-white/10' : 'bg-indigo-500/10 border border-indigo-500/20')}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {mediaIcon[m.tipo_midia] || ''} {m.papel === 'user' ? 'Vendedor' : 'IA'}
                  </span>
                  <span className="text-[10px] text-slate-500">{new Date(m.criado_em).toLocaleTimeString('pt-BR')}</span>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-200">{m.conteudo}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrcamentosTab({ mode = 'orcamentos' }: { mode?: 'orcamentos' | 'vendas' }) {
  const isVendas = mode === 'vendas';
  const defaultStatus = isVendas ? 'venda' : 'aberto';
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ numero: '', cliente_nome: '', data_de: '', data_ate: '', status: defaultStatus });
  const [selected, setSelected] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = async (override?: typeof filters) => {
    setLoading(true);
    try {
      const f = override ?? filters;
      const qs = new URLSearchParams();
      (Object.entries(f) as [string, string][]).forEach(([k, v]) => { if (v) qs.set(k, v); });
      if (isVendas) qs.set('status', 'venda');
      const res = await fetch(`/api/orcamentos?${qs.toString()}`);
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setFilters({ numero: '', cliente_nome: '', data_de: '', data_ate: '', status: defaultStatus });
    setSelected(null);
    load({ numero: '', cliente_nome: '', data_de: '', data_ate: '', status: defaultStatus });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const openDetail = async (numero: string) => {
    setDetailLoading(true);
    setSelected({ numero });
    try {
      const res = await fetch(`/api/orcamentos/${numero}`);
      setSelected(await res.json());
    } finally {
      setDetailLoading(false);
    }
  };

  const mudarStatus = async (numero: string, acao: 'fechar' | 'cancelar' | 'reabrir') => {
    const labels: Record<string, string> = {
      fechar: 'Marcar como VENDA',
      cancelar: 'Cancelar orçamento',
      reabrir: 'Reabrir orçamento',
    };
    if (!confirm(`${labels[acao]} ${numero}?`)) return;
    await fetch(`/api/orcamentos/${numero}/${acao}`, { method: 'PATCH' });
    await load();
    if (selected?.numero === numero) await openDetail(numero);
  };

  const fmtBR = (n: any) => Number(n ?? 0).toFixed(2).replace('.', ',');
  const statusBadge = (s: string) => {
    if (s === 'venda') return 'bg-emerald-500/20 text-emerald-400';
    if (s === 'cancelado') return 'bg-rose-500/20 text-rose-400';
    if (s === 'aberto') return 'bg-amber-500/20 text-amber-400';
    return 'bg-slate-500/20 text-slate-400';
  };

  const titulo = isVendas ? 'Vendas' : 'Orçamentos';
  const subtitulo = isVendas
    ? 'Orçamentos fechados como venda.'
    : 'Consulte e gerencie orçamentos em negociação.';

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">{titulo}</h2>
        <p className="text-slate-400 mt-2 text-sm sm:text-base">{subtitulo}</p>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 sm:gap-3">
          <input value={filters.numero} onChange={e => setFilters({ ...filters, numero: e.target.value })} placeholder="Nº orçamento" className="md:col-span-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500" />
          <input value={filters.cliente_nome} onChange={e => setFilters({ ...filters, cliente_nome: e.target.value })} placeholder="Cliente" className="md:col-span-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500" />
          <input type="date" value={filters.data_de} onChange={e => setFilters({ ...filters, data_de: e.target.value })} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          <input type="date" value={filters.data_ate} onChange={e => setFilters({ ...filters, data_ate: e.target.value })} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          {isVendas ? (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2 text-sm text-emerald-300 flex items-center justify-center">Vendas fechadas</div>
          ) : (
            <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
              <option value="aberto">Em aberto</option>
              <option value="cancelado">Cancelados</option>
              <option value="">Todos</option>
            </select>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => load()} className="px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 text-indigo-200 text-sm rounded-xl transition-colors">Filtrar</button>
          <button onClick={() => { const f = { numero: '', cliente_nome: '', data_de: '', data_ate: '', status: defaultStatus }; setFilters(f); load(f); }} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm rounded-xl transition-colors">Limpar</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-bold text-white text-sm">Resultados</h3>
            <span className="text-xs text-slate-500">{list.length}</span>
          </div>
          <div className="overflow-auto max-h-[55vh] sm:max-h-[60vh]">
            {loading ? (
              <p className="p-4 text-slate-500 text-sm">Carregando...</p>
            ) : list.length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">Nenhum orçamento encontrado.</p>
            ) : (
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/10">
                  <tr>
                    <th className="text-left p-3">Nº</th>
                    <th className="text-left p-3 hidden sm:table-cell">Data</th>
                    <th className="text-left p-3 hidden md:table-cell">Vendedor</th>
                    <th className="text-left p-3">Cliente</th>
                    <th className="text-right p-3 hidden sm:table-cell">Itens</th>
                    <th className="text-right p-3">Total</th>
                    <th className="text-center p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(o => (
                    <tr key={o.id} onClick={() => openDetail(o.numero)} className={cn('border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors', selected?.numero === o.numero && 'bg-indigo-500/10')}>
                      <td className="p-3 font-mono text-xs text-indigo-300 whitespace-nowrap">{o.numero}</td>
                      <td className="p-3 text-xs text-slate-400 hidden sm:table-cell whitespace-nowrap">{new Date(o.criado_em).toLocaleString('pt-BR')}</td>
                      <td className="p-3 text-xs text-slate-300 hidden md:table-cell">{o.vendedor_nome || o.vendedor_whatsapp || '—'}</td>
                      <td className="p-3 text-xs text-slate-300 max-w-[160px] truncate">{o.cliente_nome || '—'}</td>
                      <td className="p-3 text-xs text-slate-400 text-right hidden sm:table-cell">{o.qtd_itens}</td>
                      <td className="p-3 text-xs text-white text-right font-medium whitespace-nowrap">R$ {fmtBR(o.total)}</td>
                      <td className="p-3 text-center"><span className={cn('text-[10px] font-bold px-2 py-0.5 rounded', statusBadge(o.status))}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/10">
            <h3 className="font-bold text-white text-sm">Detalhe</h3>
          </div>
          <div className="overflow-auto flex-1 p-4">
            {!selected ? (
              <p className="text-slate-500 text-sm">Selecione um orçamento.</p>
            ) : detailLoading || !selected.itens ? (
              <p className="text-slate-500 text-sm">Carregando...</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="font-mono text-xs text-indigo-300">{selected.numero}</p>
                  <p className="text-xs text-slate-500 mt-1">{new Date(selected.criado_em).toLocaleString('pt-BR')}</p>
                  <span className={cn('inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded', statusBadge(selected.status))}>{selected.status}</span>
                </div>
                <div className="text-xs text-slate-400">
                  <p><span className="text-slate-500">Vendedor:</span> {selected.vendedor_nome || selected.vendedor_whatsapp || '—'}</p>
                  {selected.cliente_nome && <p><span className="text-slate-500">Cliente:</span> {selected.cliente_nome}</p>}
                </div>
                <div className="border-t border-white/10 pt-3 space-y-2">
                  {(selected.itens as any[]).map((it: any, i: number) => (
                    <div key={i} className="text-xs">
                      <p className="text-slate-200 font-medium">{i + 1}. {it.descricao}{it.marca && !String(it.descricao).toUpperCase().includes(String(it.marca).toUpperCase()) ? ` - ${it.marca}` : ''}</p>
                      <p className="text-slate-400 mt-0.5">Qtd: {it.qtd} x R$ {fmtBR(it.preco_unit)} = <span className="text-white font-medium">R$ {fmtBR(it.subtotal)}</span></p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Total</span>
                  <span className="text-lg font-bold text-white">R$ {fmtBR(selected.total)}</span>
                </div>
                <div className="space-y-2">
                  <a
                    href={`/api/orcamentos/${selected.numero}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full px-4 py-2 bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/20 text-indigo-200 text-sm rounded-xl transition-colors text-center"
                  >📄 Baixar PDF</a>
                  {selected.status === 'aberto' && (
                    <>
                      <button onClick={() => mudarStatus(selected.numero, 'fechar')} className="w-full px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-300 text-sm rounded-xl transition-colors">✅ Marcar como venda</button>
                      <button onClick={() => mudarStatus(selected.numero, 'cancelar')} className="w-full px-4 py-2 bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-300 text-sm rounded-xl transition-colors">🚫 Cancelar orçamento</button>
                    </>
                  )}
                  {(selected.status === 'venda' || selected.status === 'cancelado') && (
                    <button onClick={() => mudarStatus(selected.numero, 'reabrir')} className="w-full px-4 py-2 bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-300 text-sm rounded-xl transition-colors">↩️ Reabrir como orçamento</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientesTab() {
  const empty = {
    nome: '', fantasia: '', tipo_pessoa: '', cpf_cnpj: '',
    fone: '', celular: '', email: '', email_nfe: '',
    endereco: '', numero: '', complemento: '', bairro: '',
    cep: '', cidade: '', uf: '',
    tipo_contato: '', vendedor: '', observacoes: '',
  };
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [historico, setHistorico] = useState<any | null>(null);
  const [histLoading, setHistLoading] = useState(false);

  const fmt2 = (n: any) => Number(n ?? 0).toFixed(2).replace('.', ',');
  const histStatusBadge = (s: string) => {
    if (s === 'venda') return 'bg-emerald-500/20 text-emerald-300';
    if (s === 'cancelado') return 'bg-rose-500/20 text-rose-300';
    return 'bg-amber-500/20 text-amber-300';
  };

  const openHistorico = async (c: any) => {
    setHistorico({ cliente: c, agregados: null, orcamentos: [] });
    setHistLoading(true);
    try {
      const res = await fetch(`/api/clientes/${c.id}/historico?limit=50`);
      const data = await res.json();
      if (res.ok) setHistorico(data);
      else setHistorico({ cliente: c, error: data.error || 'Erro ao carregar', agregados: null, orcamentos: [] });
    } catch (e: any) {
      setHistorico({ cliente: c, error: e.message, agregados: null, orcamentos: [] });
    } finally {
      setHistLoading(false);
    }
  };

  const load = async (query = '') => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (query) qs.set('q', query);
      qs.set('limit', '200');
      const res = await fetch(`/api/clientes?${qs.toString()}`);
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); setMessage(''); };
  const openEdit = async (id: string) => {
    setMessage('');
    const res = await fetch(`/api/clientes/${id}`);
    const data = await res.json();
    setEditing(data);
    setForm({ ...empty, ...data });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.nome || !String(form.nome).trim()) { setMessage('Nome é obrigatório.'); return; }
    setSaving(true);
    setMessage('');
    try {
      const url = editing ? `/api/clientes/${editing.id}` : '/api/clientes';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      setMessage(editing ? 'Cliente atualizado!' : 'Cliente cadastrado!');
      setTimeout(() => { setShowForm(false); setMessage(''); load(q); }, 800);
    } catch (e: any) {
      setMessage(`Erro: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const desativar = async (id: string) => {
    if (!confirm('Desativar este cliente? Ele continuará no histórico, mas não aparece nas buscas do agente.')) return;
    await fetch(`/api/clientes/${id}`, { method: 'DELETE' });
    load(q);
  };

  const field = (k: string, label: string, opts: { wide?: boolean; placeholder?: string; type?: string } = {}) => (
    <div className={opts.wide ? 'col-span-2' : ''}>
      <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">{label}</label>
      <input
        type={opts.type || 'text'}
        value={form[k] ?? ''}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        placeholder={opts.placeholder}
        className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      />
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Clientes</h2>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Base de clientes da Win. O agente busca esses cadastros pra vincular orçamentos.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => load(q)} className="px-4 py-2 bg-white/10 text-white font-bold rounded-xl border border-white/10 hover:bg-white/20 transition-colors text-sm">Atualizar</button>
          <button onClick={openCreate} className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-indigo-900/20">+ Novo cliente</button>
        </div>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-3 sm:p-4 flex flex-col sm:flex-row gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(q); }}
          placeholder="Buscar por nome, fantasia, CPF/CNPJ, telefone..."
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <div className="flex gap-2">
          <button onClick={() => load(q)} className="flex-1 sm:flex-none px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30 text-indigo-200 text-sm rounded-xl transition-colors">Buscar</button>
          <button onClick={() => { setQ(''); load(''); }} className="flex-1 sm:flex-none px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm rounded-xl transition-colors">Limpar</button>
        </div>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[65vh] sm:h-[58vh]">
        <div className="p-4 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-bold text-white text-sm">{q ? `Resultados para "${q}"` : 'Todos os clientes'}</h3>
          <span className="text-xs text-slate-500">{list.length}</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-left min-w-[640px]">
            <thead className="bg-slate-950/50 sticky top-0 z-10 backdrop-blur-md">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Nome / Fantasia</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden lg:table-cell">Tipo</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden md:table-cell">CPF/CNPJ</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden md:table-cell">Telefone</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden lg:table-cell">Cidade/UF</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold text-center hidden sm:table-cell">Ativo</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Nenhum cliente encontrado.</td></tr>
              ) : list.map(c => (
                <tr key={c.id} className={cn('border-t border-white/5 hover:bg-white/5 transition-colors', !c.ativo && 'opacity-50')}>
                  <td className="px-3 sm:px-4 py-3">
                    <p className="text-slate-100 font-medium truncate max-w-[180px] sm:max-w-xs">{c.nome}</p>
                    {c.fantasia && c.fantasia.toLowerCase() !== String(c.nome).toLowerCase() && (
                      <p className="text-xs text-slate-500 truncate max-w-[180px] sm:max-w-xs">{c.fantasia}</p>
                    )}
                    <p className="text-[10px] text-slate-500 md:hidden mt-0.5">{c.celular || c.fone || c.cpf_cnpj || ''}</p>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">{c.tipo_pessoa || '—'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs font-mono text-slate-400 hidden md:table-cell">{c.cpf_cnpj || '—'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden md:table-cell">{c.celular || c.fone || '—'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">{c.cidade ? `${c.cidade}${c.uf ? '/' + c.uf : ''}` : '—'}</td>
                  <td className="px-3 sm:px-4 py-3 text-center hidden sm:table-cell">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold', c.ativo ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400')}>
                      {c.ativo ? 'ATIVO' : 'INATIVO'}
                    </span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1 sm:gap-2 flex-wrap justify-end">
                      <button onClick={() => openHistorico(c)} className="px-2.5 py-1 text-xs rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Hist.</button>
                      <button onClick={() => openEdit(c.id)} className="px-2.5 py-1 text-xs rounded-md bg-white/10 hover:bg-white/20 text-white">Editar</button>
                      {c.ativo && <button onClick={() => desativar(c.id)} className="px-2.5 py-1 text-xs rounded-md bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 hidden sm:inline">Desativar</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {historico && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6 bg-black/60 backdrop-blur-sm safe-pb" onClick={() => setHistorico(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-4xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-auto p-4 sm:p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-2xl font-bold text-white">Histórico do cliente</h3>
                <p className="text-slate-300 mt-1">{historico.cliente?.nome}</p>
                {historico.cliente?.fantasia && historico.cliente.fantasia.toLowerCase() !== String(historico.cliente.nome).toLowerCase() && (
                  <p className="text-xs text-slate-500">{historico.cliente.fantasia}</p>
                )}
              </div>
              <button onClick={() => setHistorico(null)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            {histLoading ? (
              <p className="text-slate-500 text-sm py-8 text-center">Carregando...</p>
            ) : historico.error ? (
              <p className="text-rose-300 text-sm py-8 text-center">{historico.error}</p>
            ) : (
              <>
                {historico.agregados && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Vendas</p>
                      <p className="text-xl font-bold text-emerald-300 mt-1">{historico.agregados.total_vendas}</p>
                      <p className="text-[10px] text-slate-500">R$ {fmt2(historico.agregados.valor_vendas)}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Orçamentos</p>
                      <p className="text-xl font-bold text-amber-300 mt-1">{historico.agregados.total_abertos}</p>
                      <p className="text-[10px] text-slate-500">abertos</p>
                    </div>
                    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Cancelados</p>
                      <p className="text-xl font-bold text-rose-300 mt-1">{historico.agregados.total_cancelados}</p>
                      <p className="text-[10px] text-slate-500">total</p>
                    </div>
                    <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Última venda</p>
                      <p className="text-sm font-bold text-white mt-1">
                        {historico.agregados.ultima_venda ? new Date(historico.agregados.ultima_venda).toLocaleDateString('pt-BR') : '—'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {historico.agregados.ultimo_orcamento ? `últ. orç. ${new Date(historico.agregados.ultimo_orcamento).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>
                  </div>
                )}

                {historico.orcamentos.length === 0 ? (
                  <p className="text-slate-500 text-sm py-8 text-center">Sem orçamentos para este cliente.</p>
                ) : (
                  <div className="rounded-2xl bg-white/5 border border-white/10 overflow-x-auto">
                    <table className="w-full text-left text-sm min-w-[560px]">
                      <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 font-bold">Número</th>
                          <th className="px-3 py-2 font-bold">Data</th>
                          <th className="px-3 py-2 font-bold">Vendedor</th>
                          <th className="px-3 py-2 font-bold text-right">Itens</th>
                          <th className="px-3 py-2 font-bold text-right">Total</th>
                          <th className="px-3 py-2 font-bold text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historico.orcamentos.map((o: any) => (
                          <tr key={o.id} className="border-t border-white/5">
                            <td className="px-3 py-2 font-mono text-xs text-indigo-300">{o.numero}</td>
                            <td className="px-3 py-2 text-xs text-slate-400">{new Date(o.criado_em).toLocaleString('pt-BR')}</td>
                            <td className="px-3 py-2 text-xs text-slate-300">{o.vendedor_nome || o.vendedor_whatsapp || '—'}</td>
                            <td className="px-3 py-2 text-xs text-slate-400 text-right">{o.qtd_itens}</td>
                            <td className="px-3 py-2 text-xs text-white text-right font-medium">R$ {fmt2(o.total)}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded', histStatusBadge(o.status))}>{o.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6 bg-black/60 backdrop-blur-sm safe-pb" onClick={() => setShowForm(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-3xl w-full max-h-[92vh] sm:max-h-[85vh] overflow-auto p-4 sm:p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl sm:text-2xl font-bold text-white">{editing ? 'Editar cliente' : 'Novo cliente'}</h3>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-3xl leading-none w-9 h-9 flex items-center justify-center">×</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('nome', 'Nome *', { wide: true, placeholder: 'Obrigatório' })}
              {field('fantasia', 'Fantasia / nome de tela', { wide: true })}
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Tipo de pessoa</label>
                <select value={form.tipo_pessoa || ''} onChange={(e) => setForm({ ...form, tipo_pessoa: e.target.value })} className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white">
                  <option value="">—</option>
                  <option value="Pessoa Física">Pessoa Física</option>
                  <option value="Pessoa Jurídica">Pessoa Jurídica</option>
                </select>
              </div>
              {field('cpf_cnpj', 'CPF / CNPJ')}
              {field('fone', 'Telefone')}
              {field('celular', 'Celular')}
              {field('email', 'E-mail')}
              {field('email_nfe', 'E-mail (NFe)')}
              {field('cep', 'CEP')}
              {field('uf', 'UF')}
              {field('cidade', 'Cidade')}
              {field('bairro', 'Bairro')}
              {field('endereco', 'Endereço', { wide: true })}
              {field('numero', 'Número')}
              {field('complemento', 'Complemento')}
              {field('tipo_contato', 'Tipo de contato', { placeholder: 'Cliente / Fornecedor / ...' })}
              {field('vendedor', 'Vendedor responsável')}
              <div className="col-span-2">
                <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Observações</label>
                <textarea
                  value={form.observacoes || ''}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                  className="w-full h-20 px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-5 pt-4 border-t border-white/10">
              <div className={cn('text-sm font-medium', message.startsWith('Erro') ? 'text-rose-400' : 'text-emerald-400')}>{message}</div>
              <div className="flex gap-2">
                <button onClick={() => setShowForm(false)} className="flex-1 sm:flex-none px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm rounded-xl">Cancelar</button>
                <button onClick={save} disabled={saving} className="flex-1 sm:flex-none px-5 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">{saving ? 'Salvando...' : (editing ? 'Salvar alterações' : 'Cadastrar')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab() {
  const [config, setConfig] = useState({ core_prompt: '', session_timeout_hours: 2, message_buffer_seconds: 5 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [webhookStatus, setWebhookStatus] = useState('');

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => { if (d) setConfig(d); });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setMessage('Configurações salvas com sucesso!');
      setTimeout(() => setMessage(''), 3000);
    } catch (e) {
      setMessage('Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleSetupWebhook = async () => {
    setWebhookStatus('Configurando...');
    try {
      const appUrl = (import.meta as any).env.VITE_APP_URL || window.location.origin;
      const res = await fetch('/api/setup-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appUrl }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(`Servidor retornou erro inesperado: ${text.slice(0, 100)}`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data.error));
      setWebhookStatus('Webhook configurado no Evolution API com sucesso!');
    } catch (e: any) {
      setWebhookStatus(`Erro: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Configurações do Agente IA</h2>
        <p className="text-slate-400 mt-2 text-sm sm:text-base">Edite as diretrizes de comportamento do assistente virtual.</p>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-6 space-y-6 shadow-sm">
        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-2">Core Prompt (Regras Estritas)</label>
          <div className="bg-yellow-500/10 text-yellow-500 text-sm p-3 rounded-xl border border-yellow-500/20 mb-3 font-medium">
            <strong>Atenção:</strong> Estas regras têm autoridade máxima e não podem ser ignoradas pela IA sob nenhuma hipótese.
          </div>
          <textarea
            value={config.core_prompt}
            onChange={(e) => setConfig({ ...config, core_prompt: e.target.value })}
            className="w-full h-48 p-4 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-slate-300 font-mono text-sm leading-relaxed"
            placeholder="Insira as regras e instruções..."
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-2">Tempo de Inatividade da Sessão (Horas)</label>
          <p className="text-xs text-slate-400 mb-3">Após este tempo sem mensagens, o sistema considera um novo atendimento. Padrão: 2h.</p>
          <input
            type="number"
            min="1"
            value={config.session_timeout_hours}
            onChange={(e) => setConfig({ ...config, session_timeout_hours: parseInt(e.target.value) || 2 })}
            className="w-full max-w-sm px-4 py-2 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-slate-300"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-2">Buffer de Mensagens (Segundos)</label>
          <p className="text-xs text-slate-400 mb-3">Quando o vendedor manda várias mensagens em sequência (ex: várias imagens), o sistema espera este tempo após a última pra processar tudo como um contexto único — evita respostas repetidas e economiza chamadas de IA. Use 0 pra desligar. Máximo: 30s. Padrão: 5s.</p>
          <input
            type="number"
            min="0"
            max="30"
            value={config.message_buffer_seconds}
            onChange={(e) => setConfig({ ...config, message_buffer_seconds: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)) })}
            className="w-full max-w-sm px-4 py-2 bg-slate-950/50 border border-white/10 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-slate-300"
          />
        </div>

        <div className="pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-white/10">
          <div className="text-sm font-medium text-green-400">{message}</div>
          <button onClick={handleSave} disabled={saving} className="bg-white text-slate-950 px-6 py-2 rounded-xl font-bold hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100 text-sm">
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-slate-950/50 backdrop-blur-xl border border-white/10 p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="font-bold text-white flex items-center">
            <MessageSquare size={18} className="mr-2 text-indigo-400" />
            Integração Evolution API
          </h3>
          <p className="text-sm text-slate-400 mt-1">Configura a URL deste painel como webhook na instância Evolution API para receber mensagens.</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 border-t border-white/10 pt-4">
          <button onClick={handleSetupWebhook} className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-600/30 transition-colors self-start">
            Configurar Webhook Agora
          </button>
          <span className={cn('text-sm font-medium break-words', webhookStatus.startsWith('Erro') ? 'text-red-400' : 'text-slate-400')}>{webhookStatus}</span>
        </div>
      </div>
    </div>
  );
}

// Agrupamento visual das permissões. Mantém PERMISSIONS como fonte da verdade;
// permissões não listadas aqui caem em "Outras" (defensivo, p/ não sumirem).
const PERMISSION_GROUPS: { label: string; perms: Permission[] }[] = [
  { label: 'Produtos', perms: ['products.view', 'products.edit', 'products.import'] },
  { label: 'Clientes', perms: ['clientes.view', 'clientes.edit', 'clientes.delete'] },
  { label: 'Orçamentos e vendas', perms: ['orcamentos.view', 'orcamentos.edit', 'vendas.view'] },
  { label: 'Vendedores e histórico', perms: ['vendedores.view', 'vendedores.edit', 'historico.view'] },
  { label: 'Sistema', perms: ['dashboard.view', 'config.view', 'config.edit', 'users.manage'] },
];

interface UserRow {
  id: string;
  email: string;
  nome: string;
  role: 'admin' | 'sub';
  vendedor_id: string | null;
  vendedor_nome: string | null;
  permissions: Permission[];
  ativo: boolean;
  criado_em: string;
  ultimo_login: string | null;
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [list, setList] = useState<UserRow[]>([]);
  const [vendedores, setVendedores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [usersRes, vendsRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/vendedores'),
      ]);
      const users = await usersRes.json();
      const vends = await vendsRes.json();
      setList(Array.isArray(users) ? users : []);
      setVendedores(Array.isArray(vends) ? vends : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setShowForm(true); setMessage(''); };
  const openEdit = (u: UserRow) => { setEditing(u); setShowForm(true); setMessage(''); };

  const toggleAtivo = async (u: UserRow) => {
    if (u.id === currentUserId) { alert('Você não pode desativar sua própria conta.'); return; }
    const novo = !u.ativo;
    if (!confirm(`${novo ? 'Ativar' : 'Desativar'} ${u.nome}?`)) return;
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: novo }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Erro');
      }
      load();
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Usuários</h2>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Crie sub-logins para o painel, defina permissões e vincule a vendedores.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="px-4 py-2 bg-white/10 text-white font-bold rounded-xl border border-white/10 hover:bg-white/20 transition-colors text-sm">Atualizar</button>
          <button onClick={openCreate} className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-indigo-900/20">+ Novo usuário</button>
        </div>
      </div>

      <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[70vh] lg:h-[68vh]">
        <div className="p-4 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-bold text-white text-sm">Usuários do painel</h3>
          <span className="text-xs text-slate-500">{list.length}</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-left min-w-[640px]">
            <thead className="bg-slate-950/50 sticky top-0 z-10 backdrop-blur-md">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Nome / E-mail</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold">Role</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden md:table-cell">Vendedor</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden lg:table-cell">Permissões</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold hidden xl:table-cell">Último login</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold text-center hidden sm:table-cell">Status</th>
                <th className="px-3 sm:px-4 py-3 sm:py-4 font-bold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Nenhum usuário cadastrado.</td></tr>
              ) : list.map(u => (
                <tr key={u.id} className={cn('border-t border-white/5 hover:bg-white/5 transition-colors', !u.ativo && 'opacity-50')}>
                  <td className="px-3 sm:px-4 py-3">
                    <p className="text-slate-100 font-medium truncate max-w-[180px]">{u.nome}</p>
                    <p className="text-xs text-slate-500 truncate max-w-[180px]">{u.email}</p>
                  </td>
                  <td className="px-3 sm:px-4 py-3">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold', u.role === 'admin' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-500/20 text-slate-300')}>
                      {u.role === 'admin' ? 'ADMIN' : 'SUB'}
                    </span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden md:table-cell">{u.vendedor_nome || '—'}</td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden lg:table-cell">
                    {u.role === 'admin' ? <span className="italic">Acesso total</span> : `${u.permissions?.length || 0} permissão(ões)`}
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-xs text-slate-400 hidden xl:table-cell whitespace-nowrap">{u.ultimo_login ? new Date(u.ultimo_login).toLocaleString('pt-BR') : 'nunca'}</td>
                  <td className="px-3 sm:px-4 py-3 text-center hidden sm:table-cell">
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold', u.ativo ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400')}>
                      {u.ativo ? 'ATIVO' : 'INATIVO'}
                    </span>
                  </td>
                  <td className="px-3 sm:px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex gap-1 sm:gap-2 flex-wrap justify-end">
                      <button onClick={() => openEdit(u)} className="px-2.5 py-1 text-xs rounded-md bg-white/10 hover:bg-white/20 text-white">Editar</button>
                      {u.id !== currentUserId && (
                        <button onClick={() => toggleAtivo(u)} className={cn('px-2.5 py-1 text-xs rounded-md border hidden sm:inline', u.ativo ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30')}>
                          {u.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <UserFormModal
          editing={editing}
          vendedores={vendedores}
          currentUserId={currentUserId}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); setMessage(''); load(); }}
        />
      )}

      {message && <div className="text-sm text-emerald-400">{message}</div>}
    </div>
  );
}

function UserFormModal({
  editing,
  vendedores,
  currentUserId,
  onClose,
  onSaved,
}: {
  editing: UserRow | null;
  vendedores: any[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!editing;
  const [email, setEmail] = useState(editing?.email || '');
  const [nome, setNome] = useState(editing?.nome || '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'sub'>(editing?.role || 'sub');
  const [vendedorId, setVendedorId] = useState<string>(editing?.vendedor_id || '');
  const [permissions, setPermissions] = useState<Permission[]>(editing?.permissions || []);
  const [ativo, setAtivo] = useState<boolean>(editing?.ativo ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Garante que toda permissão da lista canônica é considerada, mesmo que
  // o backend evolua e o agrupamento aqui fique pra trás.
  const groupedPermsSet = new Set(PERMISSION_GROUPS.flatMap(g => g.perms));
  const orphans = PERMISSIONS.filter(p => !groupedPermsSet.has(p)) as Permission[];

  const togglePerm = (p: Permission) => {
    setPermissions(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const toggleGroupAll = (groupPerms: Permission[]) => {
    const allSelected = groupPerms.every(p => permissions.includes(p));
    if (allSelected) {
      setPermissions(prev => prev.filter(p => !groupPerms.includes(p)));
    } else {
      setPermissions(prev => Array.from(new Set([...prev, ...groupPerms])));
    }
  };

  const save = async () => {
    setError('');
    if (!nome.trim()) { setError('Nome é obrigatório.'); return; }
    if (!isEdit && !email.trim()) { setError('E-mail é obrigatório.'); return; }
    if (!isEdit && password.length < 8) { setError('Senha precisa ter ao menos 8 caracteres.'); return; }
    if (isEdit && password.length > 0 && password.length < 8) { setError('Nova senha precisa ter ao menos 8 caracteres.'); return; }

    setSaving(true);
    try {
      let res: Response;
      if (isEdit) {
        const body: any = {
          nome: nome.trim(),
          role,
          vendedor_id: vendedorId || null,
          permissions: role === 'admin' ? [] : permissions,
          ativo,
        };
        if (password) body.password = password;
        res = await fetch(`/api/users/${editing!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        const body = {
          email: email.trim(),
          password,
          nome: nome.trim(),
          role,
          vendedor_id: vendedorId || null,
          permissions: role === 'admin' ? [] : permissions,
        };
        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar');
      onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const isSelf = isEdit && editing!.id === currentUserId;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-6 bg-black/60 backdrop-blur-sm safe-pb" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-3xl max-w-3xl w-full max-h-[92vh] sm:max-h-[88vh] overflow-auto p-4 sm:p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl sm:text-2xl font-bold text-white">{isEdit ? 'Editar usuário' : 'Novo usuário'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-3xl leading-none w-9 h-9 flex items-center justify-center">×</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Nome *</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">E-mail {isEdit ? '' : '*'}</label>
            <input
              type="email"
              value={email}
              disabled={isEdit}
              onChange={(e) => setEmail(e.target.value)}
              className={cn('w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white focus:ring-2 focus:ring-indigo-500', isEdit && 'opacity-60 cursor-not-allowed')}
              placeholder="usuario@empresa.com"
            />
            {isEdit && <p className="text-[10px] text-slate-500 mt-1">E-mail não pode ser alterado.</p>}
          </div>

          <div className="col-span-2">
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">
              {isEdit ? 'Nova senha (deixe vazio para manter)' : 'Senha * (mín. 8 chars)'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white focus:ring-2 focus:ring-indigo-500"
              placeholder={isEdit ? '••••••••' : 'Mínimo 8 caracteres'}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Tipo</label>
            <select
              value={role}
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value as 'admin' | 'sub')}
              className={cn('w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white', isSelf && 'opacity-60 cursor-not-allowed')}
            >
              <option value="sub">Sub-login (granular)</option>
              <option value="admin">Administrador (acesso total)</option>
            </select>
            {isSelf && <p className="text-[10px] text-slate-500 mt-1">Você não pode mudar seu próprio role.</p>}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Vendedor vinculado</label>
            <select
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-xl text-sm text-white"
            >
              <option value="">— Sem vínculo (vê tudo o que a permissão permitir) —</option>
              {vendedores.map(v => (
                <option key={v.id} value={v.id}>{v.nome || v.numero_whatsapp}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 mt-1">Se vinculado e role = sub, o usuário só enxerga dados do próprio vendedor.</p>
          </div>

          {isEdit && (
            <div className="col-span-2 flex items-center gap-2 mt-1">
              <input
                id="ativo-toggle"
                type="checkbox"
                checked={ativo}
                disabled={isSelf}
                onChange={(e) => setAtivo(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 bg-slate-950"
              />
              <label htmlFor="ativo-toggle" className={cn('text-sm text-slate-300', isSelf && 'opacity-60')}>Usuário ativo</label>
              {isSelf && <span className="text-[10px] text-slate-500">(você não pode desativar a si mesmo)</span>}
            </div>
          )}

          {role === 'sub' && (
            <div className="col-span-2 mt-2">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Permissões</p>
              <div className="space-y-4">
                {PERMISSION_GROUPS.map(g => {
                  const allSelected = g.perms.every(p => permissions.includes(p));
                  const someSelected = g.perms.some(p => permissions.includes(p));
                  return (
                    <div key={g.label} className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-slate-200">{g.label}</p>
                        <button
                          type="button"
                          onClick={() => toggleGroupAll(g.perms)}
                          className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10"
                        >
                          {allSelected ? 'Limpar tudo' : someSelected ? 'Selecionar tudo' : 'Selecionar tudo'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                        {g.perms.map(p => (
                          <label key={p} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white">
                            <input
                              type="checkbox"
                              checked={permissions.includes(p)}
                              onChange={() => togglePerm(p)}
                              className="w-4 h-4 rounded border-white/20 bg-slate-950"
                            />
                            <span>{PERMISSION_LABELS[p]}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {orphans.length > 0 && (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-xs font-bold text-amber-300 mb-2">Outras permissões</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      {orphans.map(p => (
                        <label key={p} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white">
                          <input
                            type="checkbox"
                            checked={permissions.includes(p)}
                            onChange={() => togglePerm(p)}
                            className="w-4 h-4 rounded border-white/20 bg-slate-950"
                          />
                          <span>{PERMISSION_LABELS[p] || p}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-5 pt-4 border-t border-white/10">
          <div className="text-sm font-medium text-rose-400">{error}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 sm:flex-none px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm rounded-xl">Cancelar</button>
            <button onClick={save} disabled={saving} className="flex-1 sm:flex-none px-5 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
              {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Criar usuário')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- DASHBOARD (Fase 2) ---

type PeriodPreset = 'hoje' | '7d' | 'mes' | '30d';

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computePresetRange(preset: PeriodPreset): { de: string; ate: string } {
  const now = new Date();
  if (preset === 'hoje') return { de: toIsoDate(now), ate: toIsoDate(now) };
  if (preset === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { de: toIsoDate(d), ate: toIsoDate(now) };
  }
  if (preset === '30d') {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { de: toIsoDate(d), ate: toIsoDate(now) };
  }
  // 'mes' — primeiro dia do mês até hoje
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { de: toIsoDate(first), ate: toIsoDate(now) };
}

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtUSD = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const fmtPct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

function DashboardTab() {
  const [preset, setPreset] = useState<PeriodPreset>('mes');
  const [customDe, setCustomDe] = useState<string>('');
  const [customAte, setCustomAte] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);

  const range = useMemo(() => {
    if (useCustom && customDe && customAte) return { de: customDe, ate: customAte };
    return computePresetRange(preset);
  }, [preset, useCustom, customDe, customAte]);

  const [kpis, setKpis] = useState<any | null>(null);
  const [funil, setFunil] = useState<any | null>(null);
  const [custo, setCusto] = useState<any | null>(null);
  const [ranking, setRanking] = useState<any | null>(null);
  const [produtos, setProdutos] = useState<any | null>(null);
  const [clientes, setClientes] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const qs = `?de=${range.de}&ate=${range.ate}`;
    Promise.all([
      fetch(`/api/dashboard/kpis${qs}`).then(r => r.json()),
      fetch(`/api/dashboard/funil${qs}`).then(r => r.json()),
      fetch(`/api/dashboard/custo-ia${qs}`).then(r => r.json()),
      fetch(`/api/dashboard/ranking-vendedores${qs}`).then(r => r.json()),
      fetch(`/api/dashboard/top-produtos${qs}`).then(r => r.json()),
      fetch(`/api/dashboard/clientes${qs}`).then(r => r.json()),
    ]).then(([k, f, c, r, p, cl]) => {
      if (cancelled) return;
      setKpis(k); setFunil(f); setCusto(c); setRanking(r); setProdutos(p); setClientes(cl);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'Falha ao carregar dashboard');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.de, range.ate]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Dashboard</h2>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">Visão executiva: faturamento, ranking, produtos, clientes, funil e custo de IA.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['hoje', '7d', 'mes', '30d'] as PeriodPreset[]).map(p => (
            <button key={p} onClick={() => { setPreset(p); setUseCustom(false); }}
              className={cn('px-3 py-2 rounded-xl text-xs font-bold border transition-colors',
                !useCustom && preset === p
                  ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-200'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10')}>
              {p === 'hoje' ? 'Hoje' : p === '7d' ? '7 dias' : p === 'mes' ? 'Este mês' : '30 dias'}
            </button>
          ))}
          <div className="flex items-center gap-1 w-full sm:w-auto sm:ml-2 sm:pl-2 sm:border-l sm:border-white/10">
            <input type="date" value={customDe} onChange={e => { setCustomDe(e.target.value); setUseCustom(true); }}
              className="flex-1 sm:flex-none bg-white/5 border border-white/10 text-slate-200 text-xs rounded-xl px-2 py-2" />
            <span className="text-slate-500 text-xs">→</span>
            <input type="date" value={customAte} onChange={e => { setCustomAte(e.target.value); setUseCustom(true); }}
              className="flex-1 sm:flex-none bg-white/5 border border-white/10 text-slate-200 text-xs rounded-xl px-2 py-2" />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<DollarSign size={16} />} label="Faturamento" value={kpis ? fmtBRL(kpis.faturamento_brl) : '—'} hint={kpis ? `${kpis.num_vendas} vendas` : ''} loading={loading} />
        <KpiCard icon={<Receipt size={16} />} label="Ticket médio" value={kpis ? fmtBRL(kpis.ticket_medio_brl) : '—'} loading={loading} />
        <KpiCard icon={<Target size={16} />} label="Conversão" value={kpis ? fmtPct(kpis.conversao) : '—'} hint={kpis ? `${kpis.num_vendas}/${kpis.num_orcamentos}` : ''} loading={loading} />
        <KpiCard icon={<FileText size={16} />} label="Orçamentos" value={kpis ? fmtNum(kpis.num_orcamentos) : '—'} hint={kpis ? `${kpis.num_abertos} abertos · ${kpis.num_cancelados} cancel.` : ''} loading={loading} />
      </div>

      {/* Funil + Custo IA */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Funil" subtitle="Mensagens recebidas → orçamentos → vendas">
          {!funil ? <Skeleton /> : (
            <div className="space-y-3">
              <FunnelRow label="Mensagens recebidas" value={funil.mensagens_in} color="bg-slate-500/40" pct={1} />
              <FunnelRow label="Orçamentos gerados" value={funil.orcamentos} color="bg-indigo-500/60" pct={funil.mensagens_in > 0 ? funil.orcamentos / funil.mensagens_in : 0} />
              <FunnelRow label="Vendas fechadas" value={funil.vendas} color="bg-emerald-500/60" pct={funil.mensagens_in > 0 ? funil.vendas / funil.mensagens_in : 0} />
              <div className="text-xs text-slate-400 pt-2 border-t border-white/5 grid grid-cols-2 gap-2">
                <div>Msg → Orç: <span className="text-slate-200 font-semibold">{fmtPct(funil.taxa_msg_para_orc)}</span></div>
                <div>Orç → Venda: <span className="text-slate-200 font-semibold">{fmtPct(funil.taxa_orc_para_venda)}</span></div>
              </div>
            </div>
          )}
        </Section>

        <Section title="Custo de IA" subtitle="Tokens e USD agregados (sem Whisper)">
          {!custo ? <Skeleton /> : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Custo" value={fmtUSD(custo.total_cost_usd)} />
                <Stat label="Tokens" value={fmtNum(custo.total_tokens)} />
                <Stat label="Chamadas" value={fmtNum(custo.calls)} />
              </div>
              <div className="pt-2 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Por modelo</p>
                {custo.por_modelo.length === 0 ? (
                  <p className="text-xs text-slate-500">Sem chamadas no período.</p>
                ) : custo.por_modelo.map((m: any) => (
                  <div key={m.chave} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-300 font-mono">{m.chave}</span>
                    <span className="text-slate-400">{fmtNum(m.tokens)} tk · <span className="text-slate-200 font-semibold">{fmtUSD(m.cost_usd)}</span></span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-white/5">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Por propósito</p>
                {custo.por_purpose.length === 0 ? (
                  <p className="text-xs text-slate-500">—</p>
                ) : custo.por_purpose.map((m: any) => (
                  <div key={m.chave} className="flex items-center justify-between text-xs py-1">
                    <span className="text-slate-300">{m.chave}</span>
                    <span className="text-slate-400">{fmtNum(m.calls)} calls · <span className="text-slate-200 font-semibold">{fmtUSD(m.cost_usd)}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      </div>

      {/* Ranking de vendedores */}
      <Section title="Ranking de vendedores" subtitle="Ordenado por faturamento no período">
        {!ranking ? <Skeleton /> : ranking.rows.length === 0 ? (
          <p className="text-sm text-slate-500">Sem orçamentos no período.</p>
        ) : (
          <div className="overflow-x-auto -mx-2 sm:mx-0">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="text-left py-2 px-2 sm:px-0 font-bold">Vendedor</th>
                  <th className="text-right py-2 px-2 sm:px-0 font-bold">Faturamento</th>
                  <th className="text-right py-2 px-2 sm:px-0 font-bold">Vendas</th>
                  <th className="text-right py-2 px-2 sm:px-0 font-bold hidden md:table-cell">Ticket médio</th>
                  <th className="text-right py-2 px-2 sm:px-0 font-bold hidden sm:table-cell">Conversão</th>
                  <th className="text-right py-2 px-2 sm:px-0 font-bold hidden lg:table-cell">Tempo médio</th>
                </tr>
              </thead>
              <tbody>
                {ranking.rows.map((r: any) => (
                  <tr key={r.vendedor_id} className="border-t border-white/5">
                    <td className="py-2 px-2 sm:px-0">
                      <p className="text-slate-200 font-medium truncate max-w-[200px]">{r.vendedor_nome || '(sem nome)'}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{r.vendedor_whatsapp}</p>
                    </td>
                    <td className="py-2 px-2 sm:px-0 text-right text-slate-200 font-semibold whitespace-nowrap">{fmtBRL(r.faturamento_brl)}</td>
                    <td className="py-2 px-2 sm:px-0 text-right text-slate-300 whitespace-nowrap">{r.num_vendas}/{r.num_orcamentos}</td>
                    <td className="py-2 px-2 sm:px-0 text-right text-slate-300 whitespace-nowrap hidden md:table-cell">{fmtBRL(r.ticket_medio_brl)}</td>
                    <td className="py-2 px-2 sm:px-0 text-right text-slate-300 hidden sm:table-cell">{fmtPct(r.conversao)}</td>
                    <td className="py-2 px-2 sm:px-0 text-right text-slate-400 text-xs hidden lg:table-cell">
                      {r.tempo_medio_fechamento_horas != null ? `${r.tempo_medio_fechamento_horas.toFixed(1)} h` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Top produtos */}
      <Section title="Produtos" subtitle="Mais vendidos · Cotados sem venda · Encalhados">
        {!produtos ? <Skeleton /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ProdutoColuna titulo="Mais vendidos" icon={<TrendingUp size={14} className="text-emerald-400" />} rows={produtos.mais_vendidos} mode="qtd" />
            <ProdutoColuna titulo="Cotados sem venda" icon={<TrendingDown size={14} className="text-rose-400" />} rows={produtos.mais_cotados_sem_venda} mode="qtd" />
            <ProdutoColuna titulo="Encalhados (90d)" icon={<AlertTriangle size={14} className="text-amber-400" />} rows={produtos.encalhados} mode="encalhado" />
          </div>
        )}
      </Section>

      {/* Clientes */}
      <Section title="Clientes" subtitle="Top compradores · Inativos (>60d) · Curva ABC">
        {!clientes ? <Skeleton /> : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1"><Sparkles size={12} className="text-indigo-300" /> Top compradores</p>
              {clientes.top_compradores.length === 0 ? <p className="text-xs text-slate-500">Sem vendas no período.</p> : (
                <ul className="space-y-1.5">
                  {clientes.top_compradores.map((c: any, i: number) => (
                    <li key={(c.cliente_id || c.cliente_nome) + i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-slate-300 mr-2">{i + 1}. {c.cliente_nome}</span>
                      <span className="text-slate-200 font-semibold whitespace-nowrap">{fmtBRL(c.faturamento_brl)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Inativos (sem compra há &gt;60 dias)</p>
              {clientes.inativos.length === 0 ? <p className="text-xs text-slate-500">Sem inativos.</p> : (
                <ul className="space-y-1.5">
                  {clientes.inativos.map((c: any, i: number) => (
                    <li key={(c.cliente_id || c.cliente_nome) + i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-slate-300 mr-2">{c.cliente_nome}</span>
                      <span className="text-slate-500 whitespace-nowrap">
                        {c.ultima_compra ? new Date(c.ultima_compra).toLocaleDateString('pt-BR') : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Curva ABC</p>
              {clientes.abc.total_clientes === 0 ? (
                <p className="text-xs text-slate-500">Sem dados pra ABC no período.</p>
              ) : (
                <div className="space-y-2">
                  {clientes.abc.buckets.map((b: any) => (
                    <div key={b.letra} className="flex items-center gap-2">
                      <span className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold',
                        b.letra === 'A' ? 'bg-emerald-500/20 text-emerald-300' :
                        b.letra === 'B' ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-500/20 text-slate-300')}>{b.letra}</span>
                      <div className="flex-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300">{b.clientes} cliente(s)</span>
                          <span className="text-slate-400">{fmtPct(b.faixa_faturamento_pct)} fat.</span>
                        </div>
                        <div className="h-1.5 mt-1 rounded-full bg-white/5 overflow-hidden">
                          <div className={cn('h-full',
                            b.letra === 'A' ? 'bg-emerald-500/60' :
                            b.letra === 'B' ? 'bg-amber-500/60' : 'bg-slate-500/60')}
                            style={{ width: `${Math.min(100, b.faixa_faturamento_pct * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-500 pt-1">Total: {clientes.abc.total_clientes} clientes · {fmtBRL(clientes.abc.faturamento_total_brl)}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function KpiCard({ icon, label, value, hint, loading }: { icon: React.ReactNode; label: string; value: string; hint?: string; loading?: boolean }) {
  return (
    <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-400 font-bold">
        {icon}<span>{label}</span>
      </div>
      <p className={cn('text-xl sm:text-2xl font-bold text-white mt-2 break-words', loading && 'opacity-30')}>{value}</p>
      {hint && <p className="text-[10px] text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl sm:rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 sm:p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-white">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="text-lg font-bold text-white mt-1">{value}</p>
    </div>
  );
}

function Skeleton() {
  return <div className="h-24 animate-pulse rounded-xl bg-white/5" />;
}

function FunnelRow({ label, value, color, pct }: { label: string; value: number; color: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-200 font-semibold">{fmtNum(value)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full', color)} style={{ width: `${Math.min(100, Math.max(2, pct * 100))}%` }} />
      </div>
    </div>
  );
}

function ProdutoColuna({ titulo, icon, rows, mode }: { titulo: string; icon: React.ReactNode; rows: any[]; mode: 'qtd' | 'encalhado' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">{icon}{titulo}</p>
      {rows.length === 0 ? <p className="text-xs text-slate-500">Sem dados no período.</p> : (
        <ul className="space-y-1.5">
          {rows.map((p: any, i: number) => (
            <li key={(p.descricao || '') + i} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-300">{p.descricao}</span>
                <span className="text-slate-200 font-semibold whitespace-nowrap">
                  {mode === 'qtd' ? `${fmtNum(p.qtd_total)} un` : (p.preco_venda != null ? fmtBRL(p.preco_venda) : '—')}
                </span>
              </div>
              {p.marca && <p className="text-[10px] text-slate-500">{p.marca}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
