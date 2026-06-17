import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

// Cliente final logado (espelha ClienteAuth do backend). Nunca traz senha.
export interface Cliente {
  id: string;
  nome: string;
  email: string | null;
  celular: string | null;
  fone: string | null;
  cpf_cnpj: string | null;
  tipo_pessoa: string | null;
  data_nascimento: string | null;
}

export interface RegistrarDados {
  nome: string;
  email: string;
  senha: string;
  telefone: string;
  cpf_cnpj?: string;
}

interface ContaCtx {
  cliente: Cliente | null;
  carregando: boolean; // true só durante o check inicial de sessão
  login: (email: string, senha: string) => Promise<void>;
  registrar: (dados: RegistrarDados) => Promise<void>;
  logout: () => Promise<void>;
  setCliente: (c: Cliente) => void;
}

const Ctx = createContext<ContaCtx | null>(null);

export function ContaProvider({ children }: { children: ReactNode }) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Checa a sessão no boot. 401 = não logado (estado normal), não é erro.
  useEffect(() => {
    let vivo = true;
    apiFetch<{ cliente: Cliente }>('/api/conta/me')
      .then((r) => { if (vivo) setCliente(r.cliente); })
      .catch((err) => { if (!(err instanceof ApiError && err.status === 401)) console.warn('conta/me', err); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, []);

  // Sessão expirou no meio do uso (qualquer 401 em /api): o patch global de fetch
  // dispara 'auth-expired'. Aqui derrubamos o login local — o LojaApp então
  // redireciona o painel do cliente pro /loja/entrar.
  useEffect(() => {
    const onExpirado = () => setCliente((atual) => (atual ? null : atual));
    window.addEventListener('auth-expired', onExpirado);
    return () => window.removeEventListener('auth-expired', onExpirado);
  }, []);

  const login = useCallback(async (email: string, senha: string) => {
    const r = await apiFetch<{ cliente: Cliente }>('/api/conta/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    });
    setCliente(r.cliente);
  }, []);

  const registrar = useCallback(async (dados: RegistrarDados) => {
    const r = await apiFetch<{ cliente: Cliente }>('/api/conta/registrar', {
      method: 'POST',
      body: JSON.stringify(dados),
    });
    setCliente(r.cliente);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/conta/logout', { method: 'POST' }).catch(() => {});
    setCliente(null);
  }, []);

  const value = useMemo<ContaCtx>(
    () => ({ cliente, carregando, login, registrar, logout, setCliente }),
    [cliente, carregando, login, registrar, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConta(): ContaCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useConta precisa estar dentro de <ContaProvider>');
  return ctx;
}
