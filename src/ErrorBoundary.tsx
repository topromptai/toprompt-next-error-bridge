'use client';

import { Component, type ReactNode } from 'react';
import { post } from './post.js';

/**
 * React class component boundary. Catches errors thrown during the render
 * phase of child components and forwards them to the parent via postMessage
 * with full `componentStack` info. Shows a minimal fallback UI (overridable).
 *
 * Wrap your root children with it:
 *
 *   <ErrorBoundary>{children}</ErrorBoundary>
 *
 * Or supply a custom fallback:
 *
 *   <ErrorBoundary fallback={<div>Our team has been notified.</div>}>
 *     {children}
 *   </ErrorBoundary>
 */

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    post('__TOPROMPT_ERROR__', {
      message: error.message || 'React render error',
      stack: error.stack,
      errorName: error.name,
      componentStack: info.componentStack ?? undefined,
      source: 'react-boundary',
    });
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div
          style={{
            padding: 24,
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
            color: '#dc2626',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            margin: 16,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              opacity: 0.85,
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
