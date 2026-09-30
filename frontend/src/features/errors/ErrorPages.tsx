import { Component, type ErrorInfo, type ReactNode } from "react";
import "./ErrorPages.css";

type ErrorCode = 400 | 500;

type ErrorPageProps = {
  code: ErrorCode;
  message?: string;
  onRetry?: () => void;
};

const ERROR_CONTENT: Record<ErrorCode, { eyebrow: string; title: string; description: string; detail: string }> = {
  400: {
    eyebrow: "REQUÊTE INVALIDE",
    title: "La demande n’a pas pu être traitée",
    description: "Certaines informations envoyées sont incorrectes ou incomplètes.",
    detail: "Vérifiez les champs saisis, puis réessayez. Si le problème persiste, revenez à la page précédente.",
  },
  500: {
    eyebrow: "ERREUR INTERNE",
    title: "Un problème est survenu",
    description: "Le service a rencontré une erreur inattendue.",
    detail: "Vos données ne sont pas nécessairement perdues. Réessayez dans quelques instants ou revenez à l’espace de travail.",
  },
};

export function ErrorPage({ code, message, onRetry }: ErrorPageProps) {
  const content = ERROR_CONTENT[code];

  return (
    <main className="error-screen">
      <section className="error-card" aria-labelledby="error-title">
        <div className={`error-code-mark error-code-mark--${code}`} aria-hidden="true">
          <span>{code}</span>
        </div>
        <p className="error-eyebrow">GRC TOOLS · {content.eyebrow}</p>
        <h1 id="error-title">{content.title}</h1>
        <p className="error-description">{content.description}</p>
        <p className="error-detail">{message || content.detail}</p>
        <div className="error-actions">
          {onRetry && (
            <button type="button" className="error-button error-button--primary" onClick={onRetry}>
              Réessayer
            </button>
          )}
          <button type="button" className="error-button error-button--secondary" onClick={() => { window.location.href = "/"; }}>
            Retour à l’accueil
          </button>
          <button type="button" className="error-link" onClick={() => window.history.back()}>
            Revenir à la page précédente
          </button>
        </div>
        <footer className="error-footer">
          <span className="error-footer-dot" />
          <span>Gouvernance · Risques · Contrôle</span>
          <span className="error-reference">HTTP {code}</span>
        </footer>
      </section>
    </main>
  );
}

type BoundaryProps = { children: ReactNode };
type BoundaryState = { hasError: boolean };

export class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep diagnostics in the console for development/observability; never expose stack traces to users.
    console.error("Erreur inattendue dans l’interface GRC", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorPage code={500} onRetry={() => window.location.reload()} />;
    }
    return this.props.children;
  }
}
