'use client';
import { Component, ReactNode } from 'react';

/**
 * Защита от «белого экрана смерти». Любой неперехваченный throw в дочернем
 * дереве React пойман сюда и UI заменён на читаемый fallback с кнопкой
 * перезагрузки, вместо того чтобы страница превратилась в пустую.
 *
 * Под капотом React не предоставляет hooks для error boundary —
 * только классовый componentDidCatch / getDerivedStateFromError.
 */
interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#0a0614',
        color: 'oklch(0.95 0.02 280)',
        fontFamily: 'Inter, system-ui, sans-serif',
        zIndex: 9999,
      }}>
        <div style={{
          maxWidth: 480,
          padding: 28,
          borderRadius: 18,
          background: 'rgba(30, 20, 45, 0.8)',
          backdropFilter: 'blur(20px)',
          border: '1px solid oklch(1 0 0 / 0.12)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, fontFamily: "'Space Grotesk', sans-serif" }}>
            Что-то сломалось
          </div>
          <div style={{ fontSize: 13, color: 'oklch(0.82 0.02 280 / 0.72)', marginBottom: 20 }}>
            Произошла непредвиденная ошибка в интерфейсе. Это не сломало бэкенд —
            просто перезагрузите страницу.
          </div>
          {this.state.error && (
            <details style={{
              textAlign: 'left',
              fontSize: 11,
              padding: 10,
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 8,
              marginBottom: 20,
              color: 'oklch(0.82 0.02 280 / 0.5)',
              fontFamily: 'monospace',
            }}>
              <summary style={{ cursor: 'pointer' }}>Детали</summary>
              <div style={{ marginTop: 6 }}>
                {this.state.error.message}
              </div>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 28px',
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 999,
              border: 'none',
              cursor: 'pointer',
              background: 'oklch(0.78 0.11 300)',
              color: '#1a0f2e',
            }}
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    );
  }
}
