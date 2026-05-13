import React, { useEffect, useState } from 'react';
import { PackageOpen, MessageSquare, Settings, Upload, History } from 'lucide-react';
import { cn } from './lib/utils';

export default function App() {
  const [activeTab, setActiveTab] = useState<'import' | 'products' | 'settings' | 'history'>('import');

  return (
    <div className="flex flex-col h-screen bg-[#020617] text-slate-200 font-sans overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-5%] w-[400px] h-[400px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[10%] right-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-[20%] right-[15%] w-[300px] h-[300px] bg-cyan-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <nav className="relative z-10 h-16 border-b border-white/10 backdrop-blur-md bg-white/5 flex items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <span className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">WIN <span className="font-light">DISTRIBUIDORA</span></span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-xs font-medium text-green-400 uppercase tracking-widest">Sistema Online</span>
          </div>
        </div>
      </nav>

      <div className="flex flex-1 relative z-10 overflow-hidden">
        <aside className="w-64 border-r border-white/10 backdrop-blur-md bg-white/5 p-6 flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold px-2">Navegação</p>
            <SidebarItem icon={<Upload size={16} />} label="Importação" active={activeTab === 'import'} onClick={() => setActiveTab('import')} />
            <SidebarItem icon={<PackageOpen size={16} />} label="Produtos" active={activeTab === 'products'} onClick={() => setActiveTab('products')} />
            <SidebarItem icon={<History size={16} />} label="Histórico" active={activeTab === 'history'} onClick={() => setActiveTab('history')} />
            <SidebarItem icon={<Settings size={16} />} label="Configurações" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
          </div>

          <div className="mt-auto p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl">
            <p className="text-xs text-indigo-300 font-semibold mb-1">Agente IA v2.0</p>
            <p className="text-[10px] text-indigo-400/70">Fuzzy Search · Webhook · Whisper</p>
          </div>
        </aside>

        <main className="flex-1 overflow-auto p-8 flex flex-col gap-8">
          <div className="max-w-5xl mx-auto w-full">
            {activeTab === 'import' && <ImportTab />}
            {activeTab === 'products' && <ProductsTab />}
            {activeTab === 'history' && <HistoryTab />}
            {activeTab === 'settings' && <SettingsTab />}
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
      {React.cloneElement(icon as React.ReactElement, { className: 'w-4 h-4' })}
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
        <h2 className="text-4xl font-bold text-white">Importação de Estoque</h2>
        <p className="text-slate-400 mt-2">Faça upload da planilha do Winthor. O sistema extrai automaticamente as colunas cruciais.</p>
      </div>

      <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-8 shadow-sm">
        <div className="border border-dashed border-white/20 rounded-xl p-12 text-center hover:bg-white/5 transition-colors">
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

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/products');
      setProducts(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggleAtivo = async (id: number) => {
    try {
      await fetch(`/api/products/${id}/toggle`, { method: 'PUT' });
      setProducts(products.map(p => p.id === id ? { ...p, ativo: !p.ativo } : p));
    } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-4xl font-bold text-white">Gestão de Produtos</h2>
          <p className="text-slate-400 mt-2">Consulte e edite a visibilidade dos produtos no agente de IA.</p>
        </div>
        <button onClick={fetchProducts} className="px-6 py-3 bg-white/10 text-white font-bold rounded-xl border border-white/10 hover:bg-white/20 transition-colors text-sm">
          Atualizar Lista
        </button>
      </div>

      <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col h-[65vh]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <h3 className="font-bold text-white">Estoque Sincronizado</h3>
          <span className="text-xs text-slate-400">{products.length} produtos</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-left">
            <thead className="bg-slate-950/50 sticky top-0 z-10 backdrop-blur-md">
              <tr className="text-[10px] uppercase text-slate-500">
                <th className="px-4 py-4 font-bold">Código</th>
                <th className="px-4 py-4 font-bold">Descrição</th>
                <th className="px-4 py-4 font-bold">Marca</th>
                <th className="px-4 py-4 font-bold">Categoria</th>
                <th className="px-4 py-4 font-bold">Embalagem</th>
                <th className="px-4 py-4 font-bold">Cód. Barras</th>
                <th className="px-4 py-4 font-bold">Preço</th>
                <th className="px-4 py-4 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum produto. Importe uma planilha.</td></tr>
              ) : products.map(p => (
                <tr key={p.id} className={cn('border-t border-white/5 transition-colors hover:bg-white/5', !p.ativo && 'opacity-50')}>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.codigo}</td>
                  <td className="px-4 py-3 text-sm text-slate-200 max-w-xs truncate">{p.descricao}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.marca || '--'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.categoria || '--'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{p.embalagem || '--'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-500">{p.codigo_barras || '--'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-slate-200">{p.preco_venda ? `R$ ${Number(p.preco_venda).toFixed(2)}` : '--'}</td>
                  <td className="px-4 py-3 text-center">
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
    setSessoes(await res.json());
  };

  const loadMensagens = async (sessao: any) => {
    setSelectedSessao(sessao);
    const res = await fetch(`/api/sessoes/${sessao.id}/mensagens`);
    setMensagens(await res.json());
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
        <h2 className="text-4xl font-bold text-white">Histórico de Conversas</h2>
        <p className="text-slate-400 mt-2">Visualize sessões e mensagens de cada vendedor.</p>
      </div>

      <div className="grid grid-cols-3 gap-4 h-[68vh]">
        {/* Vendedores */}
        <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col">
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
        <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/10">
            <h3 className="font-bold text-white text-sm">Sessões{selectedVendedor ? ` — ${selectedVendedor.nome || selectedVendedor.numero_whatsapp}` : ''}</h3>
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
        <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 overflow-hidden flex flex-col">
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

function SettingsTab() {
  const [config, setConfig] = useState({ core_prompt: '', session_timeout_hours: 2 });
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
        <h2 className="text-4xl font-bold text-white">Configurações do Agente IA</h2>
        <p className="text-slate-400 mt-2">Edite as diretrizes de comportamento do assistente virtual.</p>
      </div>

      <div className="rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 p-6 space-y-6 shadow-sm">
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

        <div className="pt-4 flex items-center justify-between border-t border-white/10">
          <div className="text-sm font-medium text-green-400">{message}</div>
          <button onClick={handleSave} disabled={saving} className="bg-white text-slate-950 px-6 py-2 rounded-xl font-bold hover:scale-105 active:scale-95 transition-transform disabled:opacity-50 disabled:hover:scale-100 text-sm">
            {saving ? 'Salvando...' : 'Salvar Configurações'}
          </button>
        </div>
      </div>

      <div className="rounded-3xl bg-slate-950/50 backdrop-blur-xl border border-white/10 p-6 space-y-4">
        <div>
          <h3 className="font-bold text-white flex items-center">
            <MessageSquare size={18} className="mr-2 text-indigo-400" />
            Integração Evolution API
          </h3>
          <p className="text-sm text-slate-400 mt-1">Configura a URL deste painel como webhook na instância Evolution API para receber mensagens.</p>
        </div>
        <div className="flex items-center space-x-4 border-t border-white/10 pt-4">
          <button onClick={handleSetupWebhook} className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-600/30 transition-colors">
            Configurar Webhook Agora
          </button>
          <span className={cn('text-sm font-medium', webhookStatus.startsWith('Erro') ? 'text-red-400' : 'text-slate-400')}>{webhookStatus}</span>
        </div>
      </div>
    </div>
  );
}
