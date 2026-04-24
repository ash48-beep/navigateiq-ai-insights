import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import AdminAuthGuard from '../AdminAuthGuard';

jest.mock('aws-amplify/auth');
jest.mock('../../aws-config-admin', () => ({
  configureAdminAmplify: jest.fn(),
}));
jest.mock('../../pages/AdminLoginPage', () => ({ onLogin }) => (
  <div>
    <span>Admin Login</span>
    <button onClick={onLogin}>Mock Login</button>
  </div>
));

import { configureAdminAmplify } from '../../aws-config-admin';

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminAuthGuard', () => {
  it('shows loading spinner while checking session', () => {
    fetchAuthSession.mockReturnValue(new Promise(() => {}));
    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Login')).not.toBeInTheDocument();
  });

  it('calls configureAdminAmplify on mount', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: { accessToken: { toString: () => 'tok' } } });
    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);
    expect(configureAdminAmplify).toHaveBeenCalledTimes(1);
  });

  it('shows AdminLoginPage when session has no tokens', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: null });
    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);

    await waitFor(() => {
      expect(screen.getByText('Admin Login')).toBeInTheDocument();
    });
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('shows AdminLoginPage when fetchAuthSession throws', async () => {
    fetchAuthSession.mockRejectedValue(new Error('No session'));
    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);

    await waitFor(() => {
      expect(screen.getByText('Admin Login')).toBeInTheDocument();
    });
  });

  it('renders children when session is authenticated', async () => {
    fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'valid-token' } },
    });
    render(<AdminAuthGuard><div>Protected Content</div></AdminAuthGuard>);

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
    expect(screen.queryByText('Admin Login')).not.toBeInTheDocument();
  });

  it('shows sign-out button when authenticated', async () => {
    fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'valid-token' } },
    });
    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sign out/i })).toBeInTheDocument();
    });
  });

  it('signs out and shows login page when sign-out button clicked', async () => {
    fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'valid-token' } },
    });
    signOut.mockResolvedValue(undefined);

    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);

    await waitFor(() => screen.getByRole('button', { name: /Sign out/i }));
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
      expect(screen.getByText('Admin Login')).toBeInTheDocument();
    });
  });

  it('shows login page after onLogin callback transitions to authenticated', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: null });

    render(<AdminAuthGuard><div>Protected</div></AdminAuthGuard>);

    await waitFor(() => screen.getByText('Admin Login'));

    fetchAuthSession.mockResolvedValue({
      tokens: { accessToken: { toString: () => 'new-token' } },
    });
    fireEvent.click(screen.getByRole('button', { name: /Mock Login/i }));

    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeInTheDocument();
    });
  });
});
