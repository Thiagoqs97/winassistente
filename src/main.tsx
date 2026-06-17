import './lib/install-fetch.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import LojaApp from './loja/LojaApp.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import './index.css';

// Catálogo público vive fora do muro de autenticação do painel: quando a URL é
// /loja, renderiza o app público (catálogo + conta do cliente). O resto é o painel.
const ehLoja = window.location.pathname.startsWith('/loja');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {ehLoja ? (
      <LojaApp />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW register failed:', err);
    });
  });
}
