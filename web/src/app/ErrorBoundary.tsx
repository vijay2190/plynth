import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Surface in console for DevTools too.
    // eslint-disable-next-line no-console
    console.error('[Plynth ErrorBoundary]', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 space-y-3">
          <h2 className="text-lg font-semibold text-destructive">Page crashed</h2>
          <p className="text-sm font-mono whitespace-pre-wrap break-all">{this.state.error.message}</p>
          {this.state.error.stack && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Stack</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all">{this.state.error.stack}</pre>
            </details>
          )}
          <button onClick={this.reset} className="text-sm underline">Try again</button>
        </div>
      </div>
    );
  }
}
