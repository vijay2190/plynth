import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './app/App';
import { ThemeProvider } from './app/ThemeProvider';
import './styles/globals.css';

// In dev, evict any service worker that was registered by an earlier
// production build on this hostname. Stale precache was serving wrong pages.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    let killed = false;
    for (const r of regs) { r.unregister(); killed = true; }
    if (killed && 'caches' in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => location.reload());
    } else if (killed) {
      location.reload();
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster richColors position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
