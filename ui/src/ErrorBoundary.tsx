/**
 * Error boundary for agent-authored views (and any view mounted via <Renderer>).
 *
 * A malformed spec throws during render; without a boundary the whole app
 * white-screens. This catches the error, logs it, and shows a calm fallback
 * that keeps the shell (titlebar, sidebar, palette) alive.
 *
 * Monochrome by design — danger is carried by dashed border + glyph, never hue.
 * Reduced-motion respected via CSS (view-error__retry).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Human-readable label for the view that failed (e.g. "vault view", "agent view"). */
  label: string;
  /** The child that may throw. */
  children: ReactNode;
  /** Optional callback when user clicks retry. */
  onRetry?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ error, errorInfo });

    // Log to console with the view label for context
    const label = this.props.label;
    console.error(`[ErrorBoundary:${label}]`, error);
    if (errorInfo?.componentStack) {
      console.error(errorInfo.componentStack);
    }
  }

  private handleRetry = (): void => {
    if (this.props.onRetry) {
      this.props.onRetry();
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      const { label } = this.props;
      const msg = this.state.error.message ?? 'Unknown error';

      return (
        <div className="view-error" role="alert">
          <div className="view-error__head">
            <span className="view-error__glyph" aria-hidden="true">
              !
            </span>
            <h3 className="view-error__title">
              Something broke in the {label}
            </h3>
          </div>
          <pre className="view-error__msg">{msg}</pre>
          {this.props.onRetry && (
            <button
              className="view-error__retry"
              onClick={this.handleRetry}
              type="button"
            >
              Retry
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}