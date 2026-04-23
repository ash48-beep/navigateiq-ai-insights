import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock Amplify auth before importing LoginPage
jest.mock('aws-amplify/auth', () => ({
  signIn:        jest.fn(),
  confirmSignIn: jest.fn(),
}));

// CRA doesn't transform PNG imports in test — return a stub
jest.mock('../../assets/DemandARC_Logo_FullColor_Reversed_RGB.png', () => 'logo-stub.png');

import { signIn, confirmSignIn } from 'aws-amplify/auth';
import LoginPage from '../LoginPage';

// ─── helpers ──────────────────────────────────────────────────────────────────

const fillAndSubmitLogin = (email = 'test@example.com', password = 'Password1!') => {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

const cognitoError = (name, message = name) => Object.assign(new Error(message), { name });

// ─── LoginPage — login step ───────────────────────────────────────────────────

describe('LoginPage — login step', () => {
  let onLogin;

  beforeEach(() => {
    onLogin = jest.fn();
    render(<LoginPage onLogin={onLogin} />);
  });

  afterEach(() => jest.clearAllMocks());

  test('renders email and password inputs and a sign-in button', () => {
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  test('shows validation error when email is empty', async () => {
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/please enter your email and password/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  test('shows validation error when password is empty', async () => {
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/please enter your email and password/i)).toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
  });

  test('calls signIn with lowercased trimmed email and password', async () => {
    signIn.mockResolvedValue({ isSignedIn: true });
    fillAndSubmitLogin('  Test@Example.COM  ', 'Password1!');
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({ username: 'test@example.com', password: 'Password1!' })
    );
  });

  test('calls onLogin when signIn returns isSignedIn true', async () => {
    signIn.mockResolvedValue({ isSignedIn: true });
    fillAndSubmitLogin();
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  });

  test('shows incorrect credentials error for NotAuthorizedException', async () => {
    signIn.mockRejectedValue(cognitoError('NotAuthorizedException'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });

  test('shows same generic error for UserNotFoundException', async () => {
    signIn.mockRejectedValue(cognitoError('UserNotFoundException'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  test('shows confirmation error for UserNotConfirmedException', async () => {
    signIn.mockRejectedValue(cognitoError('UserNotConfirmedException'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/account has not been confirmed/i)).toBeInTheDocument();
  });

  test('shows password reset error for PasswordResetRequiredException', async () => {
    signIn.mockRejectedValue(cognitoError('PasswordResetRequiredException'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/password reset is required/i)).toBeInTheDocument();
  });

  test('shows too many requests error for TooManyRequestsException', async () => {
    signIn.mockRejectedValue(cognitoError('TooManyRequestsException'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  test('surfaces raw message for unknown Cognito errors', async () => {
    signIn.mockRejectedValue(cognitoError('SomeUnknownError', 'Something went wrong from Cognito'));
    fillAndSubmitLogin();
    expect(await screen.findByText(/something went wrong from cognito/i)).toBeInTheDocument();
  });

  test('shows additional verification message when nextStep is unrecognised', async () => {
    signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } });
    fillAndSubmitLogin();
    expect(await screen.findByText(/additional verification required/i)).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();
  });
});

// ─── LoginPage — FORCE_CHANGE_PASSWORD step ───────────────────────────────────

describe('LoginPage — new-password step', () => {
  let onLogin;

  const advanceToNewPassword = async () => {
    signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
    });
    fillAndSubmitLogin();
    await screen.findByText(/set a permanent password/i);
  };

  beforeEach(async () => {
    onLogin = jest.fn();
    render(<LoginPage onLogin={onLogin} />);
    await advanceToNewPassword();
  });

  afterEach(() => jest.clearAllMocks());

  test('shows the new-password form after FORCE_CHANGE_PASSWORD', () => {
    expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set password/i })).toBeInTheDocument();
  });

  test('shows error when new passwords do not match', async () => {
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'Password1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Different1!' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(confirmSignIn).not.toHaveBeenCalled();
  });

  test('shows error when new password is fewer than 8 characters', async () => {
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  test('calls confirmSignIn with the new password', async () => {
    confirmSignIn.mockResolvedValue({ isSignedIn: true });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() =>
      expect(confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'NewPass1!' })
    );
  });

  test('calls onLogin after confirmSignIn succeeds', async () => {
    confirmSignIn.mockResolvedValue({ isSignedIn: true });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  });

  test('shows error when confirmSignIn returns isSignedIn false', async () => {
    confirmSignIn.mockResolvedValue({ isSignedIn: false });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewPass1!' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'NewPass1!' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    expect(await screen.findByText(/unexpected response/i)).toBeInTheDocument();
  });

  test('back button returns to the login form', async () => {
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
  });
});
