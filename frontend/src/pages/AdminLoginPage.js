import { useState } from 'react';
import { signIn, confirmSignIn } from 'aws-amplify/auth';
import './LoginPage.css';

function AdminLoginPage({ onLogin }) {
  const [step, setStep]               = useState('login');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPw, setShowPw]           = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPw, setConfirmPw]     = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [dark, setDark]               = useState(false);

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Please enter your email and password.'); return; }
    setLoading(true);
    try {
      const { isSignedIn, nextStep } = await signIn({ username: email.trim().toLowerCase(), password });
      if (isSignedIn) { onLogin(); return; }
      if (nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') { setStep('new-password'); return; }
      setError('Additional verification required.');
    } catch (err) { setError(mapError(err)); }
    finally { setLoading(false); }
  };

  const handleNewPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (!newPassword || !confirmPw)  { setError('Please fill in both fields.'); return; }
    if (newPassword !== confirmPw)   { setError('Passwords do not match.'); return; }
    if (newPassword.length < 8)      { setError('Minimum 8 characters required.'); return; }
    setLoading(true);
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword });
      if (isSignedIn) { onLogin(); }
      else { setError('Unexpected response. Please try again.'); }
    } catch (err) { setError(mapError(err)); }
    finally { setLoading(false); }
  };

  const mapError = (err) => {
    switch (err.name) {
      case 'NotAuthorizedException':   return 'Incorrect email or password.';
      case 'UserNotFoundException':    return 'Incorrect email or password.';
      case 'InvalidPasswordException': return 'Password does not meet requirements.';
      case 'TooManyRequestsException': return 'Too many attempts. Please wait.';
      default: return err.message || 'Sign-in failed.';
    }
  };

  return (
    <div className={`login-page${dark ? ' dark' : ''}`}>

      {/* ── Left branding panel ── */}
      <div className="login-left">
        <img
          src="/niq_icon-1.png"
          alt="Navigate IQ"
          className="login-left-logo"
        />
        <p className="login-left-title">Navigate IQ</p>
        <p className="login-left-sub">Admin Console</p>
      </div>

      {/* ── Right form panel ── */}
      <div className="login-right">
        <button
          className="login-theme-btn"
          onClick={() => setDark(d => !d)}
          aria-label="Toggle dark mode"
          title="Toggle dark mode"
        >
          {dark ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className="login-form-wrap">
          {step === 'login' ? (
            <>
              <h1 className="login-heading">Sign In</h1>
              <p className="login-desc">Enter your credentials to access the portal</p>

              <form className="login-form" onSubmit={handleSignIn} noValidate>
                <div className="login-field">
                  <label className="login-label" htmlFor="al-email">Email Address</label>
                  <input
                    id="al-email"
                    type="email"
                    className="login-input"
                    placeholder="your@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    disabled={loading}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="al-pw">Password</label>
                  <div className="login-input-wrap">
                    <input
                      id="al-pw"
                      type={showPw ? 'text' : 'password'}
                      className="login-input login-input--pw"
                      placeholder="Min. 8 characters"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={loading}
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="login-eye-btn"
                      onClick={() => setShowPw(v => !v)}
                      tabIndex={-1}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="login-error" role="alert">
                    <span className="login-error-icon">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" className="login-btn" disabled={loading}>
                  {loading ? <><span className="login-spinner" />Signing in…</> : 'Sign In'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="login-heading">Set New Password</h1>
              <p className="login-desc">Create a permanent password to continue</p>

              <form className="login-form" onSubmit={handleNewPassword} noValidate>
                <div className="login-info">
                  <span className="login-info-icon">ℹ</span>
                  <span>Set a permanent password to continue.</span>
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="al-npw">New Password</label>
                  <input
                    id="al-npw"
                    type="password"
                    className="login-input"
                    placeholder="Min 8 chars"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                    autoFocus
                  />
                </div>

                <div className="login-field">
                  <label className="login-label" htmlFor="al-cpw">Confirm Password</label>
                  <input
                    id="al-cpw"
                    type="password"
                    className="login-input"
                    placeholder="Re-enter password"
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>

                {error && (
                  <div className="login-error" role="alert">
                    <span className="login-error-icon">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <button type="submit" className="login-btn" disabled={loading}>
                  {loading ? <><span className="login-spinner" />Setting password…</> : 'Set Password & Sign In'}
                </button>

                <button
                  type="button"
                  className="login-btn-ghost"
                  onClick={() => { setStep('login'); setError(''); setNewPassword(''); setConfirmPw(''); }}
                  disabled={loading}
                >
                  ← Back to sign in
                </button>
              </form>
            </>
          )}

          <p className="login-footer">Admin access only</p>
        </div>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export default AdminLoginPage;
