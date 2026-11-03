import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@supabase/supabase-js', async importOriginal => {
  const original = await importOriginal<typeof import('@supabase/supabase-js')>()
  return {
    ...original,
    createClient: () => ({
      auth: { refreshSession: mocks.refreshSession },
      functions: { invoke: mocks.invoke },
    }),
  }
})

async function loadBackend() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.invalid')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  return import('./backend')
}

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('account actions', () => {
  it.each(['delete', 'provision', 'change-password'])('refreshes auth before %s and sends the fresh token', async action => {
    const { loginAction } = await loadBackend()
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-test-token' } }, error: null,
    })
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await loginAction({ action })
    expect(mocks.refreshSession).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('child-login', {
      body: { action }, headers: { Authorization: 'Bearer fresh-test-token' },
    })
  })

  it.each([
    { data: { session: null }, error: null },
    { data: { session: null }, error: new Error('private response') },
  ])('does not perform account changes when session refresh fails', async response => {
    const { loginAction } = await loadBackend()
    mocks.refreshSession.mockResolvedValue(response)
    await expect(loginAction({ action: 'provision' })).rejects.toThrow('Logg ut og inn igjen')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('keeps public child login independent of a parent session', async () => {
    const { loginAction } = await loadBackend()
    mocks.invoke.mockResolvedValue({ data: { access_token: 'child-test-token' }, error: null })
    await loginAction({ action: 'login', code: 'test-code' })
    expect(mocks.refreshSession).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('child-login', {
      body: { action: 'login', code: 'test-code' }, headers: undefined,
    })
  })

  it('explains rejected authentication without retrying the mutation', async () => {
    const { loginAction } = await loadBackend()
    const { FunctionsHttpError } = await import('@supabase/supabase-js')
    mocks.refreshSession.mockResolvedValue({
      data: { session: { access_token: 'fresh-test-token' } }, error: null,
    })
    mocks.invoke.mockResolvedValue({
      data: null, error: new FunctionsHttpError(new Response(null, { status: 401 })),
    })
    await expect(loginAction({ action: 'provision' })).rejects.toThrow('Logg ut og inn igjen')
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })
})
