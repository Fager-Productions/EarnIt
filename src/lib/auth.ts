export const AUTH_SESSION_KEY = 'ukelonn-parent-session-v1'
export const AUTH_ITERATIONS = 120000
export const AUTH_LOCK_MAX_ATTEMPTS = 5
export const AUTH_LOCK_MS = 30000
export const AUTH_IDLE_TIMEOUT_MS = 15 * 60 * 1000
export const CHILD_AUTH_ENDPOINT = import.meta.env.VITE_CHILD_AUTH_ENDPOINT?.trim() || ''
// Dev-only backdoor for local testing as a parent: only set via .env.local (gitignored),
// and import.meta.env.DEV is statically false in production builds, so this whole branch
// (including the credentials) is stripped out of anything you share/deploy.
export const ADMIN_USERNAME = import.meta.env.VITE_DEV_ADMIN_USERNAME?.trim() || 'Fager'
export const ADMIN_PASSWORD = import.meta.env.VITE_DEV_ADMIN_PASSWORD?.trim() || ''
export const ADMIN_LOGIN_ENABLED = import.meta.env.DEV && ADMIN_PASSWORD.length > 0

export function createRandomHex(bytes = 16): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(values)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function derivePasswordHash(
  password: string,
  salt: string,
  iterations = AUTH_ITERATIONS,
): Promise<string> {
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations,
      hash: 'SHA-256',
    },
    material,
    256,
  )
  const bytes = new Uint8Array(bits)
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export function isValidChildCode(value: string): boolean {
  const sanitized = value.trim()
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(sanitized)
}

export function createChildCodeCandidate(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const all = `${alphabet}${digits}`

  while (true) {
    let candidate = ''
    for (let index = 0; index < length; index += 1) {
      candidate += all[Math.floor(Math.random() * all.length)]
    }
    if (/[A-Za-z]/.test(candidate) && /\d/.test(candidate)) {
      return candidate
    }
  }
}

export function isValidParentPassword(value: string): boolean {
  const sanitized = value.trim()
  return sanitized.length >= 8 && /\d/.test(sanitized) && /[^A-Za-z0-9]/.test(sanitized)
}

export function getParentPasswordStrengthLabel(value: string): string {
  const sanitized = value.trim()
  const score = [
    sanitized.length >= 8,
    /\d/.test(sanitized),
    /[^A-Za-z0-9]/.test(sanitized),
    /[A-Z]/.test(sanitized),
  ].filter(Boolean).length
  if (score >= 4) {
    return 'Sterkt'
  }
  if (score >= 3) {
    return 'Bra'
  }
  if (score >= 2) {
    return 'Svakt'
  }
  return 'Veldig svakt'
}

export async function authenticateChildCodeWithBackend(code: string): Promise<string> {
  const response = await fetch(CHILD_AUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  })

  if (!response.ok) {
    throw new Error('Child backend auth failed')
  }

  const payload = (await response.json()) as { childId?: string }
  if (!payload.childId) {
    throw new Error('Missing childId from backend')
  }
  return payload.childId
}
