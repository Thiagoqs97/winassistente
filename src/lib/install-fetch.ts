// Monkey-patch global de fetch: injeta credentials: 'include' em qualquer
// chamada que vá para '/api/...'. Assim os componentes existentes continuam
// usando `fetch(...)` sem mudança e o cookie de auth viaja junto.
//
// Também dispara um evento custom 'auth-expired' em respostas 401 para
// permitir que o AuthContext force o logout global.

const original = window.fetch.bind(window);

function getUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

window.fetch = async (input, init = {}) => {
  const url = getUrl(input as any);
  const isApi = url.startsWith('/api') || url.includes('/api/');
  const response = await original(input as any, isApi ? { ...init, credentials: 'include' } : init);
  if (isApi && response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth-expired'));
  }
  return response;
};
