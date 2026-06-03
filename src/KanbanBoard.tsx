import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Archive, GripVertical } from 'lucide-react';
import { cn } from './lib/utils';
import { apiFetch } from './lib/api';
import { useAuth } from './auth/AuthContext';
import { hasPermission } from './lib/permissions';

type Estagio = 'novo_contato' | 'em_andamento' | 'orcamento' | 'expedicao' | 'recebido' | 'cancelado';

interface Negocio {
  id: string;
  estagio: Estagio;
  cliente_nome: string | null;
  orcamento_numero: string | null;
  orcamento_status: string | null;
  valor: string | null;
  criado_em: string;
  atualizado_em: string;
  vendedor_id: string | null;
  vendedor_nome: string | null;
  vendedor_whatsapp: string | null;
}

// Definição das colunas, na ordem em que aparecem no quadro.
const COLUNAS: { key: Estagio; label: string; dot: string; ring: string }[] = [
  { key: 'novo_contato', label: 'Novo Contato', dot: 'bg-sky-400', ring: 'border-sky-500/30' },
  { key: 'em_andamento', label: 'Em Andamento', dot: 'bg-amber-400', ring: 'border-amber-500/30' },
  { key: 'orcamento', label: 'Orçamento', dot: 'bg-indigo-400', ring: 'border-indigo-500/30' },
  { key: 'expedicao', label: 'Expedição', dot: 'bg-cyan-400', ring: 'border-cyan-500/30' },
  { key: 'recebido', label: 'Recebido', dot: 'bg-emerald-400', ring: 'border-emerald-500/30' },
  { key: 'cancelado', label: 'Cancelado', dot: 'bg-rose-400', ring: 'border-rose-500/30' },
];

const POLL_MS = 12000;

const fmtBR = (n: any) => Number(n ?? 0).toFixed(2).replace('.', ',');

function tempoRelativo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function KanbanBoard() {
  const { user } = useAuth();
  const podeMover = hasPermission(user, 'orcamentos.edit');
  // Admin (ou sub sem vínculo) vê o vendedor responsável no cartão.
  const mostrarVendedor = !user?.vendedor_id;

  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Estagio | null>(null);

  // Enquanto o usuário arrasta, pausamos o polling pra não embaralhar o quadro.
  const arrastandoRef = useRef(false);

  const load = useCallback(async (showSpinner = false) => {
    if (arrastandoRef.current) return;
    if (showSpinner) setLoading(true);
    try {
      const data = await apiFetch<Negocio[]>('/api/negocios');
      if (!arrastandoRef.current) setNegocios(Array.isArray(data) ? data : []);
      setErro('');
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const mover = useCallback(async (negocioId: string, estagio: Estagio) => {
    const atual = negocios.find(n => n.id === negocioId);
    if (!atual || atual.estagio === estagio) return;
    // Otimista: move já na UI, depois confirma no servidor.
    setNegocios(prev => prev.map(n => (n.id === negocioId ? { ...n, estagio } : n)));
    try {
      await apiFetch(`/api/negocios/${negocioId}/estagio`, {
        method: 'PATCH',
        body: JSON.stringify({ estagio }),
      });
    } catch (e: any) {
      setErro(e?.message || 'Não consegui mover o cartão');
      // Reverte em caso de erro.
      setNegocios(prev => prev.map(n => (n.id === negocioId ? { ...n, estagio: atual.estagio } : n)));
    } finally {
      load(false);
    }
  }, [negocios, load]);

  const arquivar = useCallback(async (negocioId: string) => {
    if (!confirm('Arquivar este negócio? Ele sai do quadro (o histórico é mantido).')) return;
    setNegocios(prev => prev.filter(n => n.id !== negocioId));
    try {
      await apiFetch(`/api/negocios/${negocioId}/arquivar`, { method: 'PATCH' });
    } catch (e: any) {
      setErro(e?.message || 'Não consegui arquivar');
      load(false);
    }
  }, [load]);

  const onDrop = (estagio: Estagio) => {
    setOverCol(null);
    arrastandoRef.current = false;
    const id = dragId;
    setDragId(null);
    if (id) mover(id, estagio);
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white">Kanban</h2>
          <p className="text-slate-400 mt-2 text-sm sm:text-base">
            Funil de atendimento. Os cartões avançam sozinhos conforme as conversas — arraste para ajustar manualmente.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="shrink-0 inline-flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 text-sm rounded-xl transition-colors"
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} /> Atualizar
        </button>
      </div>

      {erro && <p className="text-rose-400 text-sm">{erro}</p>}

      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
        {COLUNAS.map(col => {
          const cards = negocios.filter(n => n.estagio === col.key);
          return (
            <div
              key={col.key}
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverCol(col.key); } }}
              onDragLeave={() => setOverCol(c => (c === col.key ? null : c))}
              onDrop={() => onDrop(col.key)}
              className={cn(
                'flex-shrink-0 w-[260px] sm:w-[280px] rounded-2xl bg-white/5 border backdrop-blur-xl flex flex-col max-h-[72vh]',
                overCol === col.key ? `${col.ring} bg-white/10` : 'border-white/10'
              )}
            >
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 sticky top-0">
                <div className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', col.dot)} />
                  <span className="text-sm font-bold text-white">{col.label}</span>
                </div>
                <span className="text-[11px] text-slate-400 bg-white/5 rounded-full px-2 py-0.5">{cards.length}</span>
              </div>

              <div className="overflow-y-auto p-2 flex flex-col gap-2 flex-1">
                {loading && cards.length === 0 ? (
                  <p className="text-slate-500 text-xs p-2">Carregando…</p>
                ) : cards.length === 0 ? (
                  <p className="text-slate-600 text-xs p-2 text-center">—</p>
                ) : (
                  cards.map(card => (
                    <CardNegocio
                      key={card.id}
                      card={card}
                      podeMover={podeMover}
                      mostrarVendedor={mostrarVendedor}
                      onDragStart={() => { setDragId(card.id); arrastandoRef.current = true; }}
                      onDragEnd={() => { setDragId(null); setOverCol(null); arrastandoRef.current = false; }}
                      onMover={mover}
                      onArquivar={arquivar}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardNegocio({
  card, podeMover, mostrarVendedor, onDragStart, onDragEnd, onMover, onArquivar,
}: {
  card: Negocio;
  podeMover: boolean;
  mostrarVendedor: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMover: (id: string, estagio: Estagio) => void;
  onArquivar: (id: string) => void;
}) {
  const titulo = card.cliente_nome || 'Novo contato';
  return (
    <div
      draggable={podeMover}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-xl bg-slate-900/60 border border-white/10 p-3 text-left',
        podeMover ? 'cursor-grab active:cursor-grabbing hover:border-white/20' : 'cursor-default'
      )}
    >
      <div className="flex items-start gap-1.5">
        {podeMover && <GripVertical size={14} className="text-slate-600 mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-100 truncate">{titulo}</p>
          {card.orcamento_numero && (
            <p className="font-mono text-[11px] text-indigo-300 mt-0.5">{card.orcamento_numero}</p>
          )}
        </div>
        <button
          onClick={() => onArquivar(card.id)}
          title="Arquivar"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-500 hover:text-rose-400 shrink-0"
        >
          <Archive size={13} />
        </button>
      </div>

      <div className="flex items-center justify-between mt-2 gap-2">
        {card.valor != null ? (
          <span className="text-xs font-semibold text-white">R$ {fmtBR(card.valor)}</span>
        ) : <span />}
        <span className="text-[10px] text-slate-500">{tempoRelativo(card.atualizado_em)}</span>
      </div>

      {mostrarVendedor && (card.vendedor_nome || card.vendedor_whatsapp) && (
        <p className="text-[10px] text-slate-500 mt-1.5 truncate">
          👤 {card.vendedor_nome || card.vendedor_whatsapp}
        </p>
      )}

      {/* Fallback de toque/acessibilidade: arrastar não funciona bem no celular. */}
      {podeMover && (
        <select
          value={card.estagio}
          onChange={e => onMover(card.id, e.target.value as Estagio)}
          onClick={e => e.stopPropagation()}
          className="mt-2 w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-300 sm:hidden"
        >
          {COLUNAS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}
    </div>
  );
}
