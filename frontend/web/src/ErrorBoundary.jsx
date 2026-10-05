import React from 'react';
import { LuTriangleAlert, LuRefreshCw } from 'react-icons/lu';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', stack: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unexpected error' };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info);
    this.setState({ stack: info?.componentStack || '' });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="crash">
        <div className="crash__panel">
          <span className="crash__icon" aria-hidden="true">
            <LuTriangleAlert />
          </span>
          <h1 className="crash__title">Something went wrong</h1>
          <p className="crash__text">
            The interface hit an unexpected error. Your data and any running backend operation are
            unaffected — reloading is safe.
          </p>
          <pre className="crash__message mono">{this.state.message}</pre>
          {this.state.stack && (
            <details className="crash__details">
              <summary>Technical detail</summary>
              <pre className="mono">{this.state.stack.trim()}</pre>
            </details>
          )}
          <button type="button" className="btn btn--primary btn--md" onClick={() => window.location.reload()}>
            <LuRefreshCw className="btn__icon" aria-hidden="true" />
            <span className="btn__label">Reload the app</span>
          </button>
        </div>
      </div>
    );
  }
}
