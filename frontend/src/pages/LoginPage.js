import React, { useState } from 'react';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import './LoginPage.css';
import demandArcLogo from '../assets/DemandARC_Logo_FullColor_Reversed_RGB.png';

/**
 * LoginPage
 * Standalone login component — no dependency on the rest of the app.
 *
 * Handles two flows:
 *   1. Normal sign-in
 *   2. FORCE_CHANGE_PASSWORD — admin-created users must set a new password
 *      on first login. We collect the new password and call confirmSignIn().
 *
 * Props:
 *   onLogin  () => void   called after a successful sign-in
 */
function LoginPage({ onLogin }) {
  // ── Step: 'login' | 'new-password' ────────────────────────────
  const [step, setStep] = useState('login');

  // Login step
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  // New-password step
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Shared
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  // ── Step 1: Sign in ───────────────────────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const { isSignedIn, nextStep } = await signIn({
        username: email.trim().toLowerCase(),
        password,
      });

      if (isSignedIn) {
        onLogin();
        return;
      }

      // Admin-created user must set a new password before they can log in
      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStep('new-password');
        return;
      }

      setError('Additional verification required. Please contact your administrator.');
    } catch (err) {
      setError(mapCognitoError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Set new password ──────────────────────────────────
  const handleNewPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const { isSignedIn } = await confirmSignIn({
        challengeResponse: newPassword,
      });

      if (isSignedIn) {
        onLogin();
      } else {
        setError('Unexpected response from server. Please try again.');
      }
    } catch (err) {
      setError(mapCognitoError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Error mapper ──────────────────────────────────────────────
  const mapCognitoError = (err) => {
    switch (err.name) {
      case 'NotAuthorizedException':
        return 'Incorrect email or password. Please try again.';
      case 'UserNotFoundException':
        // Cognito often folds this into NotAuthorizedException for security;
        // show a generic message so we don't leak user-existence info.
        return 'Incorrect email or password. Please try again.';
      case 'UserNotConfirmedException':
        return 'Your account has not been confirmed. Please contact your administrator.';
      case 'PasswordResetRequiredException':
        return 'A password reset is required. Please contact your administrator.';
      case 'InvalidPasswordException':
        return 'Password does not meet requirements (min 8 chars, upper, lower, number, symbol).';
      case 'TooManyRequestsException':
      case 'LimitExceededException':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'InvalidParameterException':
        return 'Invalid input. Make sure your email is correct and try again.';
      default:
        // Surface the raw message in development so you can see exactly what Cognito returned
        return err.message || 'Sign-in failed. Please try again.';
    }
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="login-page">
      <div className="login-card">

        {/* Brand */}
        <div className="login-brand">
          <img src={demandArcLogo} alt="DemandARC" className="login-logo" />
          <h1 className="login-title">Navigate IQ Insights</h1>
          <p className="login-subtitle">
            {step === 'login'
              ? 'Sign in to access your data assistant'
              : 'Create a new password to continue'}
          </p>
        </div>

        {/* ── Step 1: Login form ── */}
        {step === 'login' && (
          <form className="login-form" onSubmit={handleSignIn} noValidate>

            <div className="login-field">
              <label className="login-label" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                className="login-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                className="login-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>

            {error && <ErrorBanner message={error} />}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <><span className="login-spinner" aria-hidden="true" />Signing in…</> : 'Sign In'}
            </button>

          </form>
        )}

        {/* ── Step 2: New password form ── */}
        {step === 'new-password' && (
          <form className="login-form" onSubmit={handleNewPassword} noValidate>

            <div className="login-info">
              <span className="login-info-icon">ℹ</span>
              <span>
                Your account was created by an administrator. Please set a permanent password to continue.
              </span>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                className="login-input"
                placeholder="Min 8 chars, upper, lower, number, symbol"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
                autoFocus
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                className="login-input"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>

            {error && <ErrorBanner message={error} />}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <><span className="login-spinner" aria-hidden="true" />Setting password…</> : 'Set Password & Sign In'}
            </button>

            <button
              type="button"
              className="login-btn-ghost"
              onClick={() => { setStep('login'); setError(''); setNewPassword(''); setConfirmPassword(''); }}
              disabled={loading}
            >
              ← Back to sign in
            </button>

          </form>
        )}

        <p className="login-footer">Access is managed by your administrator</p>
      </div>
    </div>
  );
}

// ── Small helper ──────────────────────────────────────────────────
function ErrorBanner({ message }) {
  return (
    <div className="login-error" role="alert">
      <span className="login-error-icon">⚠</span>
      <span>{message}</span>
    </div>
  );
}

export default LoginPage;
