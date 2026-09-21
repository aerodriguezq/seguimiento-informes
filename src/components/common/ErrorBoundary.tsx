import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Props;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-2.5 text-xs text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{this.props.fallbackLabel || 'Este bloque no pudo cargarse.'}</p>
            <p className="mt-0.5 text-rose-600/80">{this.state.error.message}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
