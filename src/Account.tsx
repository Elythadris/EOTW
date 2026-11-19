import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthProvider, CallbackResult, Settings } from '@netlify/identity';

type View = 'login' | 'signup' | 'recover' | 'invite' | 'password';
type AccountState = { enabled: boolean; signedIn: boolean };
const callbackHash = () => /(?:^#|&)(?:access_token|invite_token|confirmation_token|recovery_token|email_change_token|error_description)=/.test(window.location.hash);

export function routeIdentityCallback() {
  if (callbackHash() && window.location.pathname !== '/watchlist') {
    window.history.replaceState(null, '', '/watchlist' + window.location.hash);
  }
}

function refreshAccount() {
  try {
    localStorage.removeItem('eotw.preferences.v1');
    localStorage.removeItem('eotw.preferences.v1.pending');
  } catch { /* Browser storage can be unavailable in private browsing. */ }
  window.location.replace('/watchlist');
}

let pendingCallback: Promise<CallbackResult | null> | undefined;
const providerNames: Record<AuthProvider, string> = { google: 'Google', github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', facebook: 'Facebook', email: 'Email' };

export default function Account() {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [view, setView] = useState<View>('login');
  const [invite, setInvite] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      if (callbackHash() || pendingCallback) {
        const identity = await import('@netlify/identity');
        pendingCallback ??= identity.handleAuthCallback();
        const result = await pendingCallback;
        if (!live) return;
        if (result?.type === 'invite' && result.token) {
          setInvite(result.token); setView('invite'); setAccount({ enabled: true, signedIn: false }); return;
        }
        if (result?.type === 'recovery') {
          setView('password'); setAccount({ enabled: true, signedIn: true }); return;
        }
        if (result) { refreshAccount(); return; }
      }
      const response = await fetch('/api/preferences', { cache: 'no-store' });
      if (!response.ok && response.status !== 401) return;
      const current: AccountState = response.status === 401 ? { enabled: true, signedIn: false } : (await response.json()).account;
      if (!live || !current) return;
      setAccount(current);
      if (current.enabled && !current.signedIn) {
        const identity = await import('@netlify/identity');
        const options = await identity.getSettings();
        if (live) setSettings(options);
      }
    };
    load().catch(() => { if (live) setMessage('Account access is temporarily unavailable.'); });
    return () => { live = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    setBusy(true); setMessage('');
    try {
      const identity = await import('@netlify/identity');
      if (view === 'recover') {
        await identity.requestPasswordRecovery(email);
        setMessage('If the account exists, a recovery link is on its way.'); setView('login');
      } else if (view === 'signup') {
        await identity.signup(email, password);
        if (settings?.autoconfirm) refreshAccount();
        else { setMessage('Check your email to confirm your account.'); setView('login'); }
      } else {
        if (view === 'invite') await identity.acceptInvite(invite, password);
        else if (view === 'password') await identity.updateUser({ password });
        else await identity.login(email, password);
        refreshAccount();
      }
    } catch {
      setMessage('The account request could not be completed. Check your details or try again.');
    } finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await (await import('@netlify/identity')).logout(); refreshAccount(); }
    catch { setMessage('Sign-out failed. Please try again.'); setBusy(false); }
  }

  async function oauth(provider: AuthProvider) {
    setBusy(true);
    try { (await import('@netlify/identity')).oauthLogin(provider); }
    catch { setMessage('Provider sign-in is unavailable.'); setBusy(false); }
  }

  if (!account?.enabled && !message) return null;
  const authLink = (next: View, label: string) => <button type="button" disabled={busy} onClick={() => { setMessage(''); setView(next); }}>{label}</button>;
  const passwordOnly = view === 'invite' || view === 'password';
  const formTitle = { login: 'Sign in', signup: 'Create account', recover: 'Send recovery email', invite: 'Accept invitation', password: 'Save new password' }[view];
  return <section className="account-settings" aria-label="Account" style={{display:'grid', gap:'0.8rem', marginBlock:'1.5rem'}}>
    <h3>Account</h3>
    {message && <p role="status">{message}</p>}
    {account?.signedIn && !passwordOnly ? <>
      <p>Your watchlist and chat history sync with this account.</p>
      <button type="button" disabled={busy} onClick={signOut}>Sign out</button>
    </> : <>
      {settings && <p>Sign in to use an account watchlist across devices. Your guest watchlist stays separate.</p>}
      {!passwordOnly && settings && Object.entries(settings.providers).filter(([id, enabled]) => enabled && id !== 'email').map(([id]) =>
        <button type="button" disabled={busy} key={id} onClick={() => oauth(id as AuthProvider)}>Continue with {providerNames[id as AuthProvider]}</button>)}
      {(passwordOnly || settings?.providers.email) && <form onSubmit={submit} style={{ display:'grid', gap:'0.65rem', maxWidth:'28rem' }}>
        {!passwordOnly && <label>Email <input type="email" name="email" autoComplete="email" required /></label>}
        {view !== 'recover' && <label>Password <input type="password" name="password" autoComplete={view === 'login' ? 'current-password' : 'new-password'} minLength={view === 'login' ? 1 : 8} required /></label>}
        <button disabled={busy} type="submit">{formTitle}</button>
      </form>}
      {settings?.providers.email && !passwordOnly && <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
        {view === 'login' && !settings.disableSignup && authLink('signup', 'Create account')}
        {view === 'login' && authLink('recover', 'Forgot password?')}
        {view !== 'login' && authLink('login', 'Back to sign in')}
      </div>}
    </>}
  </section>;
}
