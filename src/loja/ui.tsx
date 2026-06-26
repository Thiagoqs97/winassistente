// UI compartilhada do catálogo público e do painel do cliente: ícones monoline
// (stroke consistente, currentColor — sem emoji), helpers de formatação e a
// marca WIN. Fonte única pra catálogo (Loja) e conta (Entrar/MinhaConta).

export const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Botão de ação principal (dourado da logo WIN). Usado com parcimônia.
export const BTN_OURO =
  'bg-gradient-to-b from-gold-300 to-gold-500 hover:from-gold-200 hover:to-gold-600 text-navy-900 shadow-[0_8px_24px_-10px_rgba(207,156,44,0.7)]';

export const SEGMENTOS_CLIENTE = [
  'Farmácia',
  'Academia',
  'Loja de suplementos',
  'Mercado',
  'Conveniência',
  'Clinica',
  'Revendedor',
  'E-commerce',
  'Outro',
];

export type IconProps = { className?: string };

export function IconSearch({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
    </svg>
  );
}
export function IconBag({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7V6a3 3 0 0 1 6 0v1" />
    </svg>
  );
}
export function IconPlus({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
export function IconMinus({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}
export function IconArrow({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function IconArrowLeft({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </svg>
  );
}
export function IconCheck({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
export function IconBox({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" />
    </svg>
  );
}
export function IconUser({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  );
}
export function IconMail({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  );
}
export function IconLock({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
export function IconPin({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-5.6 7-11a7 7 0 0 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
export function IconReceipt({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3l-2 1.5L15 3l-2 1.5L11 3 9 4.5 7 3 5 4.5Z" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
export function IconLogout({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
    </svg>
  );
}
export function IconTrash({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />
    </svg>
  );
}
export function IconWhats({ className = '' }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.8c2.17 0 4.2.84 5.74 2.38a8.07 8.07 0 0 1 2.38 5.73c0 4.47-3.64 8.11-8.12 8.11a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.12.82.83-3.04-.2-.31a8.05 8.05 0 0 1-1.24-4.3c0-4.47 3.64-8.11 8.12-8.11Zm-2.6 4.36c-.13 0-.34.05-.52.24-.18.2-.69.68-.69 1.65 0 .97.71 1.91.81 2.04.1.13 1.39 2.21 3.43 3.01 1.7.67 2.05.54 2.42.5.37-.03 1.2-.49 1.37-.96.17-.47.17-.87.12-.96-.05-.08-.18-.13-.38-.23-.2-.1-1.2-.59-1.39-.66-.18-.07-.32-.1-.45.1-.13.2-.51.66-.63.79-.12.13-.23.15-.43.05-.2-.1-.85-.31-1.62-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.07-.13.03-.25-.02-.35-.05-.1-.44-1.08-.62-1.48-.16-.38-.33-.33-.45-.34l-.38-.01Z" />
    </svg>
  );
}
export function IconSpinner({ className = '' }: IconProps) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Marca WIN em maiúsculas condensadas — usada na logo do header/footer.
export function Wordmark({ size = 'base' }: { size?: 'base' | 'lg' }) {
  return (
    <span className="leading-none">
      <span className={`block font-display font-bold text-white tracking-wide ${size === 'lg' ? 'text-xl' : 'text-lg'}`}>WIN</span>
      <span className={`block font-display uppercase tracking-[0.34em] text-gold-400 ${size === 'lg' ? 'text-[10px]' : 'text-[9px]'}`}>Distribuidora</span>
    </span>
  );
}
