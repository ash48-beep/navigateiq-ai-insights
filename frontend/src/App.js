import './index.css';
import './App.css';

import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Chatbot    from './components/Chatbot';
import AuthGuard  from './components/AuthGuard';
import AdminAuthGuard from './components/AdminAuthGuard';
import AdminDashboard from './pages/AdminDashboard';
import { ClientConfigProvider } from './context/ClientConfigContext';

// ── Client route — reads slug from URL, loads config, shows Chatbot ────────
function ClientApp() {
  const { slug } = useParams();
  return (
    <ClientConfigProvider slug={slug}>
      <AuthGuard>
        <Chatbot />
      </AuthGuard>
    </ClientConfigProvider>
  );
}

// ── Admin route ────────────────────────────────────────────────────────────
function AdminApp() {
  return (
    <AdminAuthGuard>
      <AdminDashboard />
    </AdminAuthGuard>
  );
}

// ── Root app with routing ──────────────────────────────────────────────────
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin dashboard — accessible only on the admin port */}
        <Route path="/admin" element={<AdminApp />} />

        {/* Client app — /:slug e.g. /DemandARC */}
        <Route path="/:slug" element={<ClientApp />} />

        {/* Root — show nothing, each client has their own slug URL */}
        <Route path="/" element={
          <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#0f1419',
            color: 'rgba(255,255,255,0.3)',
            fontFamily: 'sans-serif',
            fontSize: 14,
          }}>
            Navigate IQ
          </div>
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
