import React, { useState, useEffect, useCallback } from 'react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
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

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setAuthState('unauthenticated');
    }
  };

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
          // Clear any /login path from the URL so the user lands on the root
          if (window.location.pathname !== '/') {
            window.history.replaceState({}, '', '/');
          }
          setAuthState('authenticated');
        }}
      />
    );
  }

  return (
    <>
      {/* Sign-out button — positioned fixed, top-right, above all content */}
      <button
        onClick={handleSignOut}
        title="Sign out"
        style={{
          position: 'fixed',
          top: 12,
          right: 16,
          zIndex: 9999,
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          padding: '6px 14px',
          color: 'rgba(255,255,255,0.65)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          backdropFilter: 'blur(8px)',
          transition: 'background 0.2s, color 0.2s',
          letterSpacing: '0.2px',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
          e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)';
          e.currentTarget.style.color = '#fca5a5';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
          e.currentTarget.style.color = 'rgba(255,255,255,0.65)';
        }}
      >
        <span style={{ fontSize: 13 }}>⎋</span>
        Sign out
      </button>

      {children}
    </>
  );
}

export default AuthGuard;
