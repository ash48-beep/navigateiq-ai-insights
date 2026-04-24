import React, { createContext, useContext, useState, useEffect } from 'react';
import { Amplify } from 'aws-amplify';

const ClientConfigContext = createContext(null);

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3002/api/v1';

/**
 * Append a cache-busting query param to an S3 (or any) image URL.
 * Ensures that when an admin re-uploads an asset to the same S3 key,
 * the browser does not serve a stale cached version.
 * A single timestamp is generated per config fetch, so URLs stay stable
 * for the duration of a session (no flicker on re-render).
 */
function withCacheBust(url, version) {
  if (!url) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${version}`;
}

/**
 * ClientConfigProvider
 * Reads the client slug from the URL, fetches config from the backend,
 * configures Amplify dynamically, and injects CSS variables for theming.
 *
 * Usage: wrap client routes with this provider.
 */
export function ClientConfigProvider({ slug, children }) {
  const [config, setConfig]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!slug) {
      setError('No client slug provided');
      setLoading(false);
      return;
    }

    const fetchConfig = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/client-config/${slug}`);

        if (!res.ok) {
          throw new Error(`Client "${slug}" not found`);
        }

        const data = await res.json();

        // One cache-bust token per fetch. Admin re-uploads overwrite the same
        // S3 key, so the URL is identical — the browser would keep the old
        // image. Appending ?v=<ts> forces a fresh fetch each time the page
        // loads (but stays stable within a session so no flicker).
        const version = Date.now();
        const theme   = data.theme || {};
        const processed = {
          ...data,
          theme: {
            ...theme,
            logoUrl:        withCacheBust(theme.logoUrl,        version),
            headerImageUrl: withCacheBust(theme.headerImageUrl, version),
            faviconUrl:     withCacheBust(theme.faviconUrl,     version),
          },
        };

        // Configure Amplify with this client's Cognito pool
        Amplify.configure({
          Auth: {
            Cognito: {
              userPoolId:       data.cognito.userPoolId,
              userPoolClientId: data.cognito.clientId,
              loginWith: { email: true },
            },
          },
        });

        // Inject CSS variables so LoginPage + Chatbot theme automatically
        const root = document.documentElement;
        root.style.setProperty('--primary',       theme.primaryColor);
        root.style.setProperty('--primary-light', theme.primaryColorLight);
        root.style.setProperty('--bg-from',       theme.bgFrom);
        root.style.setProperty('--bg-to',         theme.bgTo);
        root.style.setProperty('--accent',        theme.accentColor);

        // Set favicon dynamically — remove any existing icon links first so
        // browsers don't hold on to the previous one
        if (processed.theme.faviconUrl) {
          document
            .querySelectorAll("link[rel~='icon']")
            .forEach(el => el.parentNode.removeChild(el));
          const link = document.createElement('link');
          link.rel  = 'icon';
          link.href = processed.theme.faviconUrl;
          document.head.appendChild(link);
        }

        console.log(data);
        
        // Set page title
        if (data.name) {
          document.title = data.name;
        }

        setConfig(processed);
      } catch (err) {
        setError(err.message || 'Failed to load client config');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [slug]);

  if (loading) {
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

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f1419',
        color: 'rgba(255,255,255,0.5)',
        fontFamily: 'sans-serif',
        fontSize: 14,
      }}>
        {error}
      </div>
    );
  }

  return (
    <ClientConfigContext.Provider value={config}>
      {children}
    </ClientConfigContext.Provider>
  );
}

/** Hook to read client config in any child component */
export function useClientConfig() {
  return useContext(ClientConfigContext);
}
