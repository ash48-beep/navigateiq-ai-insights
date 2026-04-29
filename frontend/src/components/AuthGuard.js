import { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';
import LoginPage from '../pages/LoginPage';

/**
 * AuthGuard
 * Wraps any protected content. Shows LoginPage if unauthenticated.
 * Injects a sign-out button in the top-right corner of the page.
 */
function AuthGuard({ children }) {
  const [authState, setAuthState] = useState('loading'); // 'loading' | 'authenticated' | 'unauthenticated'

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
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f1419 0%, #1a1d29 100%)',
      }}>
        <div style={{
          width: 36, height: 36,
          border: '3px solid rgba(255,255,255,0.15)',
          borderTopColor: '#4e9af1',
          borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <LoginPage
        onLogin={() => {
          // Stay on the current path — do not redirect, let React Router keep the slug
          setAuthState('authenticated');
        }}
      />
    );
  }

  return <>{children}</>;
}

export default AuthGuard;
