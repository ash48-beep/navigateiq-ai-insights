import React, { useState } from 'react';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import './LoginPage.css'; // reuse same styles

function AdminLoginPage({ onLogin }) {
  const [step, setStep]                   = useState('login');
  const [email, setEmail]                 = useState('');
  const [password, setPassword]           = useState('');
  const [newPassword, setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError]                 = useState('');
  const [loading, setLoading]             = useState(false);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and password.'); return; }

    setLoading(true);
    try {
      const { isSignedIn, nextStep } = await signIn({
        username: email.trim().toLowerCase(),
        password,
      });

      if (isSignedIn) { onLogin(); return; }

      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStep('new-password');
        return;
      }

      setError('Additional verification required.');
    } catch (err) {
      setError(mapError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (!newPassword || !confirmPassword) { setError('Please fill in both fields.'); return; }
    if (newPassword !== confirmPassword)  { setError('Passwords do not match.'); return; }
    if (newPassword.length < 8)           { setError('Minimum 8 characters required.'); return; }

    setLoading(true);
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword });
      if (isSignedIn) { onLogin(); }
      else { setError('Unexpected response. Please try again.'); }
    } catch (err) {
      setError(mapError(err));
    } finally {
      setLoading(false);
    }
  };

  const mapError = (err) => {
    switch (err.name) {
      case 'NotAuthorizedException':    return 'Incorrect email or password.';
      case 'UserNotFoundException':     return 'Incorrect email or password.';
      case 'InvalidPasswordException':  return 'Password does not meet requirements.';
      case 'TooManyRequestsException':  return 'Too many attempts. Please wait.';
      default: return err.message || 'Sign-in failed.';
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <h1 className="login-title">Navigate IQ</h1>
          <p className="login-subtitle">Admin Portal</p>
        </div>

        {step === 'login' && (
          <form className="login-form" onSubmit={handleSignIn} noValidate>
            <div className="login-field">
              <label className="login-label" htmlFor="admin-email">Email</label>
              <input id="admin-email" type="email" className="login-input"
                placeholder="admin@example.com" value={email}
                onChange={e => setEmail(e.target.value)} disabled={loading}
                autoComplete="email" autoFocus />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="admin-password">Password</label>
              <input id="admin-password" type="password" className="login-input"
                placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} disabled={loading}
                autoComplete="current-password" />
            </div>
            {error && <div className="login-error" role="alert"><span className="login-error-icon">⚠</span><span>{error}</span></div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <><span className="login-spinner" />Signing in…</> : 'Sign In'}
            </button>
          </form>
        )}

        {step === 'new-password' && (
          <form className="login-form" onSubmit={handleNewPassword} noValidate>
            <div className="login-info">
              <span className="login-info-icon">ℹ</span>
              <span>Set a permanent password to continue.</span>
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="np">New Password</label>
              <input id="np" type="password" className="login-input"
                placeholder="Min 8 chars" value={newPassword}
                onChange={e => setNewPassword(e.target.value)} disabled={loading} autoFocus />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="cp">Confirm Password</label>
              <input id="cp" type="password" className="login-input"
                placeholder="Re-enter password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)} disabled={loading} />
            </div>
            {error && <div className="login-error" role="alert"><span className="login-error-icon">⚠</span><span>{error}</span></div>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? <><span className="login-spinner" />Setting password…</> : 'Set Password & Sign In'}
            </button>
            <button type="button" className="login-btn-ghost"
              onClick={() => { setStep('login'); setError(''); }} disabled={loading}>
              ← Back
            </button>
          </form>
        )}

        <p className="login-footer">Admin access only</p>
      </div>
    </div>
  );
}

export default AdminLoginPage;
