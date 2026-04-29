import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import { configureAdminAmplify } from '../aws-config-admin';
import AdminLoginPage from '../pages/AdminLoginPage';

/**
 * AdminAuthGuard
 * Configures Amplify with the admin pool, then checks session.
 * Shows AdminLoginPage if unauthenticated, children if authenticated.
 */
function AdminAuthGuard({ children }) {
  const [authState, setAuthState] = useState('loading');

  // Configure Amplify for admin pool once on mount
  useEffect(() => {
    configureAdminAmplify();
  }, []);

  const checkSession = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      if (session?.tokens?.accessToken) {
        setAuthState('authenticated');
      } else {
        setAuthState('unauthenticated');
      }
    } catch {
      setAuthState('unauthenticated');
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);


  if (authState === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f1419 0%, #1a1d29 100%)',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: '#4e9af1', borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <AdminLoginPage onLogin={() => setAuthState('authenticated')} />;
  }

  return <>{children}</>;
}

export default AdminAuthGuard;
