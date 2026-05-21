import { useEffect, useState } from 'react';
import { Download, Share, Plus, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'win-install-dismissed-at';
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari expõe navigator.standalone; o resto usa display-mode.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ se anuncia como Mac; checa touch.
  const isIPadOS = ua.includes('Macintosh') && 'ontouchend' in document;
  return isIDevice || isIPadOS;
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (wasRecentlyDismissed()) return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };

    const onInstalled = () => {
      setShow(false);
      setDeferred(null);
      try { localStorage.removeItem(DISMISS_KEY); } catch {}
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS: nunca dispara beforeinstallprompt. Mostra banner com instruções
    // depois de um pequeno delay pra não atrapalhar o primeiro paint.
    if (isIOS()) {
      const t = setTimeout(() => setShow(true), 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    setShowIosHelp(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  };

  const onInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        setShow(false);
      } else {
        dismiss();
      }
      setDeferred(null);
      return;
    }
    // Sem evento → provavelmente iOS, mostra instruções.
    if (isIOS()) setShowIosHelp(true);
  };

  return (
    <>
      <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[60] w-[calc(100%-1.5rem)] max-w-md safe-pb pointer-events-none">
        <div className="pointer-events-auto rounded-2xl border border-indigo-500/30 bg-slate-900/95 backdrop-blur-xl shadow-2xl p-3 flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
            <Download className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">Instalar o app WIN</p>
            <p className="text-[11px] text-slate-400 leading-snug mt-0.5">Acesso rápido pela tela inicial, sem barra do navegador.</p>
          </div>
          <button
            onClick={onInstall}
            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-bold rounded-xl whitespace-nowrap"
          >
            Instalar
          </button>
          <button
            onClick={dismiss}
            aria-label="Fechar"
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-slate-400"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {showIosHelp && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-3 bg-black/60 backdrop-blur-sm safe-pb" onClick={() => setShowIosHelp(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-white">Instalar no iPhone</h3>
              <button onClick={() => setShowIosHelp(false)} aria-label="Fechar" className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8">×</button>
            </div>
            <ol className="space-y-3 text-sm text-slate-300">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-bold">1</span>
                <span>Toque no botão <Share className="inline w-4 h-4 mx-1 text-sky-400" /> <strong>Compartilhar</strong> na barra de baixo do Safari.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-bold">2</span>
                <span>Role para baixo e toque em <Plus className="inline w-4 h-4 mx-1 text-slate-200" /> <strong>Adicionar à Tela de Início</strong>.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-xs font-bold">3</span>
                <span>Confirme tocando em <strong>Adicionar</strong>. Pronto — o ícone do WIN fica na sua tela inicial.</span>
              </li>
            </ol>
            <button onClick={dismiss} className="mt-5 w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl">Entendi</button>
          </div>
        </div>
      )}
    </>
  );
}
