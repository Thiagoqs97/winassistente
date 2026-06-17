import { useEffect, useState } from 'react';

// Roteamento client-side mínimo pro app público (/loja, /loja/entrar, /loja/conta).
// Sem react-router: o backend serve index.html pra qualquer rota de /loja e o
// LojaApp escolhe a tela pelo pathname. navegar() usa history.pushState e dispara
// popstate pra notificar os hooks (pushState não emite popstate sozinho).

export function navegar(path: string) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRota(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}
