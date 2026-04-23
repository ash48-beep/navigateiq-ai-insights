import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  signOut:          jest.fn(),
}));

// Avoid loading LoginPage's CSS/asset dependencies in this suite
jest.mock('../../pages/LoginPage', () => ({ onLogin }) => (
  <button onClick={onLogin} data-testid="mock-login-page">Mock Login</button>
));

import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import AuthGuard from '../AuthGuard';

// ─── helpers ──────────────────────────────────────────────────────────────────

const authenticated = () =>
  fetchAuthSession.mockResolvedValue({ tokens: { accessToken: 'tok-abc' } });

const unauthenticated = () =>
  fetchAuthSession.mockResolvedValue({ tokens: null });

const sessionError = () =>
  fetchAuthSession.mockRejectedValue(new Error('No session'));

// ─── AuthGuard ────────────────────────────────────────────────────────────────

describe('AuthGuard', () => {
  afterEach(() => jest.clearAllMocks());

  test('shows a loading spinner while session is being checked', () => {
    // Never resolve so we stay in loading state
    fetchAuthSession.mockReturnValue(new Promise(() => {}));
    render(<AuthGuard><div>protected</div></AuthGuard>);
    // Loading spinner is a div with circular border styling — no text content;
    // verify protected content is not shown yet
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  test('shows LoginPage when session has no tokens', async () => {
    unauthenticated();
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(await screen.findByTestId('mock-login-page')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  test('shows LoginPage when fetchAuthSession throws', async () => {
    sessionError();
    render(<AuthGuard><div>protected</div></AuthGuard>);
    expect(await screen.findByTestId('mock-login-page')).toBeInTheDocument();
  });

  test('renders children when session has a valid accessToken', async () => {
    authenticated();
    render(<AuthGuard><div>protected content</div></AuthGuard>);
    expect(await screen.findByText('protected content')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-login-page')).not.toBeInTheDocument();
  });

  test('renders sign-out button when authenticated', async () => {
    authenticated();
    render(<AuthGuard><div>app</div></AuthGuard>);
    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  test('clicking sign-out calls signOut and shows LoginPage', async () => {
    authenticated();
    signOut.mockResolvedValue(undefined);
    render(<AuthGuard><div>app</div></AuthGuard>);

    const signOutBtn = await screen.findByRole('button', { name: /sign out/i });
    fireEvent.click(signOutBtn);

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('mock-login-page')).toBeInTheDocument();
  });

  test('still transitions to unauthenticated when signOut throws', async () => {
    authenticated();
    signOut.mockRejectedValue(new Error('network error'));
    render(<AuthGuard><div>app</div></AuthGuard>);

    const signOutBtn = await screen.findByRole('button', { name: /sign out/i });
    fireEvent.click(signOutBtn);

    expect(await screen.findByTestId('mock-login-page')).toBeInTheDocument();
  });

  test('clicking mock login page calls onLogin and shows children again', async () => {
    unauthenticated();
    render(<AuthGuard><div>protected</div></AuthGuard>);

    const loginBtn = await screen.findByTestId('mock-login-page');
    fireEvent.click(loginBtn);

    expect(await screen.findByText('protected')).toBeInTheDocument();
  });
});
