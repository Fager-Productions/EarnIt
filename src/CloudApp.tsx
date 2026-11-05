import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import App from './App'
import InstallHelp from './InstallHelp'
import { cloudConfigurationError, cloudEnabled, familyRpc, loginAction, requireBackend, signInChild } from './lib/backend'
import type { CloudContext, FamilySnapshot } from './lib/backend'
import type { AppState } from './types'

export default function CloudApp() {
  if (cloudConfigurationError) return <main role="alert">
    Skytjenesten er ufullstendig konfigurert. Sett både VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY.
    Lokale familiedata er ikke lastet.
  </main>
  return cloudEnabled ? <AuthenticatedApp /> : <App />
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [snapshot, setSnapshot] = useState<FamilySnapshot | null>(null)
  const [error, setError] = useState(() => {
    const query = new URLSearchParams(location.search)
    const fragment = new URLSearchParams(location.hash.slice(1))
    return query.has('error') || fragment.has('error')
      ? 'Gjenopprettingslenken er ugyldig eller utløpt. Be om en ny lenke.' : ''
  })
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'parent' | 'child' | 'recovery'>('parent')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [notice, setNotice] = useState('')
  const [recovery, setRecovery] = useState(/(?:type=recovery)/.test(location.hash + location.search))
  const operationRef = useRef(false)
  const generationRef = useRef(0)
  const sessionUserRef = useRef<string | null>(null)

  const accept = useCallback((next: FamilySnapshot) => {
    setSnapshot(previous => previous && (next.revision < previous.revision ||
      (next.revision === previous.revision && next.role === previous.role && next.childId === previous.childId
        && JSON.stringify(next.state) === JSON.stringify(previous.state)))
      ? previous : next)
  }, [])

  useEffect(() => {
    const backend = requireBackend()
    let live = true
    const { data: { subscription } } = backend.auth.onAuthStateChange((event, next) => {
      if (!live) return
      if (sessionUserRef.current !== (next?.user.id ?? null)) {
        generationRef.current += 1
        setSnapshot(null)
        sessionUserRef.current = next?.user.id ?? null
      }
      setSession(next)
      setReady(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    void backend.auth.getSession().then(({ data, error: authError }) => {
      if (!live) return
      if (authError) setError(authError.message)
      sessionUserRef.current = data.session?.user.id ?? null
      setSession(data.session)
      setReady(true)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])

  const mustChange = Boolean(session?.user.app_metadata.must_change_password)
  useEffect(() => {
    if (!session || recovery || mustChange) return
    let live = true
    const refresh = async () => {
      if (operationRef.current) return
      const generation = generationRef.current
      try {
        const next = await familyRpc('get_family_state')
        if (live && generation === generationRef.current && !operationRef.current) accept(next)
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Kunne ikke hente familiens data.')
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 10000)
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { live = false; clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [session, recovery, mustChange, accept])

  const operation = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    if (operationRef.current) throw new Error('En endring pågår. Vent og prøv igjen.')
    operationRef.current = true
    setBusy(true)
    setError('')
    try { return await action() }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Endringen mislyktes.')
      throw cause
    } finally { operationRef.current = false; setBusy(false) }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await operation(async () => {
        const backend = requireBackend()
        if (session && (recovery || mustChange)) {
          await loginAction({ action: 'change-password', password })
          const { error: refreshError } = await backend.auth.refreshSession()
          if (refreshError) throw refreshError
          setRecovery(false)
          setPassword('')
          setNotice('Passordet er endret.')
        } else if (mode === 'recovery') {
          const { error: resetError } = await backend.auth.resetPasswordForEmail(email, {
            redirectTo: `${location.origin}${location.pathname}`,
          })
          if (resetError) throw resetError
          setNotice('Hvis e-postadressen finnes, sendes en lenke for passordbytte.')
        } else if (mode === 'child') {
          await signInChild(code)
          setCode('')
        } else {
          const { error: loginError } = await backend.auth.signInWithPassword({ email, password })
          if (loginError) throw loginError
          setPassword('')
        }
      })
    } catch { /* operation has displayed the failure; event handlers do not return rejected promises. */ }
  }

  const logout = useCallback(async () => {
    await operation(async () => {
      const { error: logoutError } = await requireBackend().auth.signOut()
      if (logoutError) throw logoutError
      setSnapshot(null)
      setRecovery(false)
    })
  }, [operation])

  const cloud = useMemo<CloudContext | undefined>(() => snapshot ? {
    state: snapshot.state, role: snapshot.role, childId: snapshot.childId,
    saveState: (next: AppState) => operation(async () => {
      const result = await familyRpc('save_family_state', {
        p_state: next, p_expected_revision: snapshot.revision,
      })
      accept(result)
      return result.state
    }),
    registerEntry: (taskType, taskId) => operation(async () => {
      const next = await familyRpc('register_child_entry', { p_task_type: taskType, p_task_id: taskId })
      accept(next)
      return next.state
    }),
    removeEntry: entryId => operation(async () => {
      const next = await familyRpc('remove_child_entry', { p_entry_id: entryId })
      accept(next)
      return next.state
    }),
    createChildLogin: childId => operation(async () => {
      await loginAction({ action: 'delete', childId })
      const result = await loginAction({ action: 'provision', childId })
      if (!result.code) throw new Error('Barnets kode mangler i svaret.')
      return result.code
    }),
    removeChildLogin: childId => operation(async () => { await loginAction({ action: 'delete', childId }) }),
    logout,
  } : undefined, [snapshot, operation, accept, logout])

  return <div>
    {error && <div role="alert" style={{ padding: 16, background: '#ffe8e8', color: '#600' }}>
      {error} <button onClick={() => setError('')}>Lukk</button>
      {session && !recovery && !mustChange && <button disabled={busy} onClick={() => {
        void operation(async () => { accept(await familyRpc('get_family_state')) }).catch(() => {})
      }}>Hent nyeste data</button>}
    </div>}
    {notice && <p role="status">{notice}</p>}
    {!ready ? <p>Laster innlogging …</p> :
      session && !recovery && !mustChange ?
        snapshot ? <App cloud={cloud} onChangeCloudPassword={
          snapshot.role === 'parent' && !busy ? () => setRecovery(true) : undefined
        } /> : <p>Laster familiens data … <button onClick={() => {
          void logout().catch(() => {})
        }}>Logg ut</button></p> :
        <main className="app-shell cloud-login">
          <header className="hero-panel">
            <div>
              <p className="eyebrow">ØrnIt</p>
              <div className="hero-title-row">
                <h1>
                  <span className="hero-brand">ØrnIt</span>
                  <span className="hero-slogan">Bygg vaner. Spar smart</span>
                </h1>
                <div className="hero-title-icons" aria-hidden="true">
                  <img src="/money-bills.svg" alt="" />
                  <img src="/credit-card.svg" alt="" />
                </div>
              </div>
            </div>
          </header>
          <InstallHelp />
          <section className="card auth-card">
          <h2>{session ? (mustChange ? 'Velg ditt eget passord før første bruk' : 'Bytt passord') :
            mode === 'recovery' ? 'Glemt passord' : 'Logg inn'}</h2>
          <p className="mini login-help">Hver familie har separate data. Barn bruker sin egen kode.</p>
          {!session && <nav className="role-switch" aria-label="Velg innlogging">
            <button className={mode === 'parent' ? 'primary' : ''} aria-pressed={mode === 'parent'}
              onClick={() => setMode('parent')}>Forelder</button>
            <button className={mode === 'child' ? 'primary' : ''} aria-pressed={mode === 'child'}
              onClick={() => setMode('child')}>Barn</button>
            <button className={mode === 'recovery' ? 'primary' : ''} aria-pressed={mode === 'recovery'}
              onClick={() => setMode('recovery')}>Glemt passord</button>
          </nav>}
          <form className="cloud-login-form" onSubmit={submit}>
            {!session && (
              mode === 'child' ? <label>Barnets kode<input autoComplete="off" required value={code}
                onChange={event => setCode(event.target.value)} /></label> :
                <label>E-post<input type="email" autoComplete="username" required value={email}
                  onChange={event => setEmail(event.target.value)} /></label>)}
            {(session || mode === 'parent') && <label>{session ? 'Nytt passord (minst 12 tegn)' : 'Passord'}
              <input type="password" required minLength={session ? 12 : undefined}
                autoComplete={session ? 'new-password' : 'current-password'}
                value={password} onChange={event => setPassword(event.target.value)} /></label>}
            <button className="primary" disabled={busy} type="submit">{busy ? 'Venter …' :
              session ? 'Lagre nytt passord' : mode === 'recovery' ? 'Send gjenopprettingslenke' : 'Logg inn'}</button>
          </form>
          {session && <button disabled={busy} onClick={() => { void logout().catch(() => {}) }}>Logg ut</button>}
          </section>
        </main>}
  </div>
}
