import { useEffect } from 'react';
import { ContaProvider, useConta } from './conta/ContaContext';
import { useRota, navegar } from './nav';
import { IconSpinner } from './ui';
import Loja from './Loja';
import Entrar from './conta/Entrar';
import MinhaConta from './conta/MinhaConta';

function TelaCarregando() {
  return (
    <div className="min-h-screen bg-navy-900 bg-dots flex items-center justify-center text-gold-400">
      <IconSpinner className="w-8 h-8" />
    </div>
  );
}

// Decide a tela pelo pathname. /loja/conta exige login (redireciona pro /loja/entrar);
// /loja/entrar com sessão ativa pula direto pro painel. Catálogo é a tela padrão.
function Rotas() {
  const path = useRota();
  const { cliente, carregando } = useConta();
  const querEntrar = path.startsWith('/loja/entrar');
  const querConta = path.startsWith('/loja/conta');

  useEffect(() => {
    if (querEntrar && !carregando && cliente) navegar('/loja/conta');
  }, [querEntrar, carregando, cliente]);

  useEffect(() => {
    if (querConta && !carregando && !cliente) navegar('/loja/entrar?next=/loja/conta');
  }, [querConta, carregando, cliente]);

  if (querEntrar) {
    if (carregando) return <TelaCarregando />;
    return cliente ? <TelaCarregando /> : <Entrar />;
  }
  if (querConta) {
    if (carregando || !cliente) return <TelaCarregando />;
    return <MinhaConta />;
  }
  return <Loja />;
}

export default function LojaApp() {
  return (
    <ContaProvider>
      <Rotas />
    </ContaProvider>
  );
}
