import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import './index.css';

// Apply the stored theme before first paint so there is no light-mode flash.
try {
  const stored = localStorage.getItem('zerotrace.theme');
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  document.documentElement.setAttribute(
    'data-theme',
    stored === 'light' || stored === 'dark' ? stored : prefersLight ? 'light' : 'dark'
  );
} catch {
  document.documentElement.setAttribute('data-theme', 'dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
