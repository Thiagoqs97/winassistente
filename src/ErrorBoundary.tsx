import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  // Mudar a key (ex.: aba ativa) remonta o boundary e limpa o erro.
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

// Sem isto, qualquer exceção no render de uma aba desmonta a árvore inteira
// e o usuário vê só o fundo escuro (tela preta). Aqui isolamos a falha na área
// de conteúdo, mantendo a navegação e oferecendo recuperação.
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro no painel:', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl sm:rounded-3xl bg-rose-500/10 border border-rose-500/20 p-6 sm:p-8 text-center animate-in fade-in duration-300">
          <p className="text-lg font-semibold text-rose-200">Algo deu errado ao carregar esta área.</p>
          <p className="text-slate-400 mt-2 text-sm">
            Tente novamente. Se persistir, peça ao administrador para revisar suas permissões.
          </p>
          <button
            onClick={this.reset}
            className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-medium text-white"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
