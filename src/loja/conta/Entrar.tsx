import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { navegar } from '../nav';
import { useConta } from './ContaContext';
import { BTN_OURO, IconArrowLeft, IconSpinner, IconUser, IconMail, IconLock, IconCheck, Wordmark } from '../ui';

type Modo = 'entrar' | 'criar';

function destinoPosLogin(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  // Só aceita caminhos internos do /loja — evita open-redirect.
  if (next && next.startsWith('/loja')) return next;
  return '/loja/conta';
}

// Telefone só com dígitos -> (86) 98863-6999. Aceita 10 ou 11 dígitos.
function formatarTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const COMO_FUNCIONA = [
  'Acompanhe seus pedidos e o status de cada um',
  'Salve seus endereços de entrega',
  'Finalize novos pedidos em segundos',
];

export default function Entrar() {
  const { login, registrar } = useConta();
  const [modo, setModo] = useState<Modo>('entrar');

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [senha, setSenha] = useState('');

  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    try {
      setEnviando(true);
      if (modo === 'entrar') {
        await login(email, senha);
      } else {
        await registrar({ nome, email, senha, telefone, cpf_cnpj: cpfCnpj || undefined });
      }
      navegar(destinoPosLogin());
    } catch (err: any) {
      setErro(err instanceof ApiError ? err.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  const inputBase =
    'w-full rounded-xl border border-slate-300 pl-11 pr-4 py-3 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition';

  return (
    <div className="min-h-screen bg-navy-900 bg-dots flex flex-col safe-pt safe-pb">
      <header className="max-w-5xl w-full mx-auto px-4 py-4 flex items-center justify-between">
        <a href="/loja" className="flex items-center gap-2.5">
          <img src="/logowin.png" alt="WIN Distribuidora" className="h-10 w-10 rounded-lg ring-1 ring-white/10" />
          <Wordmark />
        </a>
        <button
          onClick={() => navegar('/loja')}
          className="inline-flex items-center gap-2 text-slate-300 hover:text-gold-300 text-sm font-semibold transition"
        >
          <IconArrowLeft className="w-4 h-4" /> Voltar ao catálogo
        </button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl grid lg:grid-cols-2 rounded-3xl overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-white/10">
          {/* Painel editorial (desktop) */}
          <div className="hidden lg:flex flex-col justify-between bg-navy-800 text-white p-10 relative overflow-hidden">
            <span className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-gold-300 via-gold-500 to-transparent" />
            <div>
              <p className="font-display uppercase tracking-[0.3em] text-[11px] text-gold-400 font-semibold">Sua conta WIN</p>
              <h1 className="mt-4 font-display font-bold uppercase leading-[0.95] tracking-tight text-4xl">
                Seus pedidos,<br /><span className="text-gold-400">do seu jeito.</span>
              </h1>
              <p className="mt-5 text-slate-300 text-sm leading-relaxed max-w-xs">
                Crie sua conta pra fechar pedidos mais rápido e acompanhar tudo num só lugar.
              </p>
            </div>
            <ul className="mt-10 space-y-3">
              {COMO_FUNCIONA.map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-slate-200">
                  <IconCheck className="w-4 h-4 text-gold-400 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>

          {/* Formulário */}
          <div className="bg-white p-7 sm:p-10">
            <div className="flex rounded-xl bg-slate-100 p-1 mb-7">
              {(['entrar', 'criar'] as Modo[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setModo(m); setErro(null); }}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
                    modo === m ? 'bg-white text-navy-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {m === 'entrar' ? 'Entrar' : 'Criar conta'}
                </button>
              ))}
            </div>

            <h2 className="font-display uppercase tracking-tight text-2xl font-bold text-ink">
              {modo === 'entrar' ? 'Bem-vindo de volta' : 'Crie sua conta'}
            </h2>
            <p className="text-slate-500 text-sm mt-1 mb-6">
              {modo === 'entrar' ? 'Entre com seu e-mail e senha.' : 'É rápido — só os dados essenciais.'}
            </p>

            <form onSubmit={submeter} className="space-y-3.5">
              {modo === 'criar' && (
                <div className="relative">
                  <IconUser className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Nome completo"
                    autoComplete="name"
                    className={inputBase}
                  />
                </div>
              )}

              <div className="relative">
                <IconMail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="E-mail"
                  autoComplete="email"
                  className={inputBase}
                />
              </div>

              {modo === 'criar' && (
                <>
                  <div className="relative">
                    <IconUser className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      value={telefone}
                      onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
                      placeholder="Celular com DDD"
                      inputMode="tel"
                      autoComplete="tel"
                      className={inputBase}
                    />
                  </div>
                  <div className="relative">
                    <IconUser className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      value={cpfCnpj}
                      onChange={(e) => setCpfCnpj(e.target.value)}
                      placeholder="CPF ou CNPJ (opcional)"
                      className={inputBase}
                    />
                  </div>
                </>
              )}

              <div className="relative">
                <IconLock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder={modo === 'criar' ? 'Senha (mín. 8 caracteres)' : 'Senha'}
                  autoComplete={modo === 'criar' ? 'new-password' : 'current-password'}
                  className={inputBase}
                />
              </div>

              {erro && (
                <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm border border-red-100">{erro}</div>
              )}

              <button
                type="submit"
                disabled={enviando}
                className={`w-full ${BTN_OURO} font-bold rounded-xl py-3.5 transition-all active:scale-[0.99] disabled:opacity-60 flex items-center justify-center gap-2`}
              >
                {enviando && <IconSpinner className="w-5 h-5" />}
                {modo === 'entrar' ? 'Entrar' : 'Criar conta'}
              </button>
            </form>

            <p className="text-center text-sm text-slate-500 mt-6">
              {modo === 'entrar' ? (
                <>Ainda não tem conta?{' '}
                  <button onClick={() => { setModo('criar'); setErro(null); }} className="font-semibold text-navy-700 hover:text-gold-600 underline-offset-2 hover:underline">Criar agora</button>
                </>
              ) : (
                <>Já tem conta?{' '}
                  <button onClick={() => { setModo('entrar'); setErro(null); }} className="font-semibold text-navy-700 hover:text-gold-600 underline-offset-2 hover:underline">Entrar</button>
                </>
              )}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
