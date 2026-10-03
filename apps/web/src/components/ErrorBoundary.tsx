import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Si una pantalla falla, mostrar el error con salidas en vez de dejar la ventana vacía. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Lifty:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="pair-screen">
        <div className="card pad pair-card">
          <h1>Algo salió mal</h1>
          <p className="muted">Esta pantalla tuvo un error. Tus datos están a salvo.</p>
          <pre className="error-detail">{error.message}</pre>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                window.location.hash = '/';
                window.location.reload();
              }}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
