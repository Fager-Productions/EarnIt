import { createClient, FunctionsHttpError } from '@supabase/supabase-js'
import type { AppState, UserRole } from '../types'

export type CloudContext = {
  state: AppState
  role: UserRole
  childId?: string
  saveState(next: AppState): Promise<AppState>
  registerEntry(taskType: 'mandatory' | 'bonus', taskId: string): Promise<AppState>
  removeEntry(entryId: string): Promise<AppState>
  createChildLogin(childId: string): Promise<string>
  removeChildLogin(childId: string): Promise<void>
  logout(): Promise<void>
}

export type FamilySnapshot = {
  state: AppState
  revision: number
  role: UserRole
  childId?: string
}

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const cloudEnabled = Boolean(url && key)
export const cloudConfigurationError = Boolean(url) !== Boolean(key)
export const supabase = cloudEnabled ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export function requireBackend() {
  if (!supabase) throw new Error('Skytjenesten er ikke konfigurert.')
  return supabase
}

export function decodeSnapshot(value: unknown): FamilySnapshot {
  const data = value as FamilySnapshot
  if (!data || !Number.isSafeInteger(data.revision) || !['parent', 'child'].includes(data.role)
    || !Array.isArray(data.state?.profiles) || !data.state.parentSettings
    || (data.role === 'child' && typeof data.childId !== 'string')) {
    throw new Error('Ugyldig svar fra skytjenesten.')
  }
  // Local credential fields exist in AppState for legacy mode, never in persisted cloud JSON.
  return {
    ...data,
    childId: data.childId ?? undefined,
    state: {
      ...data.state,
      parentSettings: {
        ...data.state.parentSettings,
        parentAccounts: [],
        passwordHash: null, passwordSalt: null, passwordIterations: 210000,
        childPinHash: null, childPinSalt: null, childPinIterations: 210000,
        legacyPin: undefined,
      },
      profiles: data.state.profiles.map(profile => ({
        ...profile, childPinPlain: null, childPinHash: null,
        childPinSalt: null, childPinIterations: 210000,
      })),
    },
  }
}

export async function familyRpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await requireBackend().rpc(name, args)
  if (error) throw new Error(error.message)
  return decodeSnapshot(data)
}

export async function loginAction(body: Record<string, unknown>) {
  const backend = requireBackend()
  let headers: Record<string, string> | undefined
  if (body.action !== 'login') {
    const { data: refreshed, error: refreshError } = await backend.auth.refreshSession()
    if (refreshError || !refreshed.session) {
      throw new Error('Kunne ikke fornye foreldreinnloggingen. Logg ut og inn igjen før du prøver på nytt.')
    }
    headers = { Authorization: `Bearer ${refreshed.session.access_token}` }
  }
  const { data, error } = await backend.functions.invoke('child-login', { body, headers })
  if (error instanceof FunctionsHttpError && error.context.status === 401) {
    throw new Error('Innloggingen ble avvist av serveren. Logg ut og inn igjen før du prøver på nytt.')
  }
  if (error) throw new Error('Innlogging eller kontoendring mislyktes. Prøv igjen eller kontakt en forelder.')
  if (!data || data.error) throw new Error('Innlogging eller kontoendring mislyktes.')
  return data as { code?: string; access_token?: string; refresh_token?: string }
}

export async function signInChild(code: string) {
  const data = await loginAction({ action: 'login', code })
  if (!data.access_token || !data.refresh_token) throw new Error('Ugyldig innloggingssvar.')
  const { error } = await requireBackend().auth.setSession({
    access_token: data.access_token, refresh_token: data.refresh_token,
  })
  if (error) throw new Error(error.message)
}
