import './lib/install-fetch.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Loja from './loja/Loja.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import './index.css';

// Catálogo público vive fora do muro de autenticação: quando a URL é /loja,
// renderiza a vitrine direto, sem AuthProvider/login. O resto é o painel.
const ehLoja = window.location.pathname.startsWith('/loja');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {ehLoja ? (
      <Loja />
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
