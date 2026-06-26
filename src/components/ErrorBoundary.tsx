import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    const { children } = this.props;
    if (this.state.hasError) {
      let message = 'Algo salió mal. Por favor, intenta de nuevo más tarde.';
      
      try {
        // Try to parse if it's a FirestoreErrorInfo JSON
        const errObj = JSON.parse(this.state.error?.message || '');
        if (errObj.error && errObj.error.includes('insufficient permissions')) {
          message = 'No tienes permisos suficientes para realizar esta acción o ver estos datos.';
        } else if (errObj.error && (errObj.error.toLowerCase().includes('quota') || errObj.error.toLowerCase().includes('limit') || errObj.error.toLowerCase().includes('resource'))) {
          message = 'Se ha alcanzado el límite diario de consultas de base de datos de Firebase. Por favor, intente de nuevo mañana o solicite ampliar el plan del proyecto en la consola de Firebase.';
        }
      } catch (e) {
        // Not a JSON error, keep default message
        const errStr = String(this.state.error?.message || '').toLowerCase();
        if (errStr.includes('quota') || errStr.includes('limit') || errStr.includes('resource_exhausted')) {
          message = 'Se ha alcanzado el límite diario de consultas de base de datos de Firebase. Por favor, intente de nuevo mañana o solicite ampliar el plan del proyecto en la consola de Firebase.';
        }
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center border border-red-100">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Error de Aplicación</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Recargar Página
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
