import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import App from './App.tsx';
import LandingPage, { servicePath, type OrganizationSession } from './components/LandingPage.tsx';
import ServiceAdminPortal from './components/admin/ServiceAdminPortal.tsx';
import CustomerQuestionnaire from './components/mesaleads/CustomerQuestionnaire.tsx';
import MesaLeadsApp from './components/mesaleads/MesaLeadsApp.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
});

function RootRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/mesaleads/q/')) {
    const token = path.slice('/mesaleads/q/'.length);
    return <CustomerQuestionnaire token={token} />;
  }
  if (path === '/mesaleads' || path.startsWith('/mesaleads/')) return <MesaLeadsApp />;
  if (path === '/admin') return <ServiceAdminPortal />;
  if (path === '/') {
    const hasMachineDeepLink = new URLSearchParams(window.location.search).has('machine');
    if (hasMachineDeepLink) return <App />;
    return (
      <LandingPage
        onEnterService={(session: OrganizationSession, serviceId: string) => {
          window.localStorage.setItem('erp_session', JSON.stringify(session));
          const destination = servicePath(serviceId);
          if (destination) window.location.assign(destination);
        }}
      />
    );
  }
  if (path === '/mesaops' || path.startsWith('/mesaops/')) return <App />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootRoute />
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed', err);
    });
  });
}
