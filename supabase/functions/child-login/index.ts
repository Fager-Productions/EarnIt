import { createClient } from '@supabase/supabase-js'

const url = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const pepper = Deno.env.get('CHILD_CODE_PEPPER')!
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean)
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const encoder = new TextEncoder()

function randomString(length: number) {
  // Alphabet size 32 divides 256; no modulo bias. Codes are case-insensitive.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), n => alphabet[n % 32]).join('')
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)) }
function unbase64(text: string) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)) }
async function hash(text: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))),
    n => n.toString(16).padStart(2, '0')).join('')
}
async function encryptionKey() {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(`password-encryption:${pepper}`))
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function encrypt(password: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), encoder.encode(password))
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`
}
async function decrypt(ciphertext: string) {
  const [iv, encrypted] = ciphertext.split('.')
  return new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unbase64(iv) }, await encryptionKey(), unbase64(encrypted)))
}
function check(error: { message: string } | null) {
  if (error) throw new Error('Backend operation failed')
}
async function readBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Request body missing')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > 4096) {
      await reader.cancel()
      throw new Error('Request body too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(bytes))
}

Deno.serve(async request => {
  const origin = request.headers.get('origin')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (origin && !allowedOrigins.includes(origin)) return respond({ error: 'Request failed' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return respond({ error: 'Request failed' }, 405)
  if (!pepper || pepper.length < 32) return respond({ error: 'Service unavailable' }, 503)
  try {
    const body = await readBody(request)
    if (body.action === 'login') {
      const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
      const codeHash = await hash(`code:${code.slice(0, 100)}`)
      // Supabase's hosted gateway provides this forwarding header. Never trust arbitrary
      // caller-supplied IP headers if deploying behind a different proxy; configure that proxy.
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
      const { data: allowed, error: limitError } = await admin.rpc('consume_login_attempt', {
        p_ip_hash: await hash(`ip:${ip}`), p_code_hash: codeHash,
      })
      check(limitError)
      if (!allowed || !/^[A-Z0-9]{16}$/.test(code)) return respond({ error: 'Login failed' }, 400)
      const { data: login, error } = await admin.from('child_logins')
        .select('email,password_ciphertext').eq('code_hash', codeHash).maybeSingle()
      check(error)
      if (!login) return respond({ error: 'Login failed' }, 400)
      // A fresh client avoids service client's session being overwritten by child auth.
      const auth = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      const { data, error: signInError } = await auth.auth.signInWithPassword({
        email: login.email, password: await decrypt(login.password_ciphertext),
      })
      if (signInError || !data.session) return respond({ error: 'Login failed' }, 400)
      return respond({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
    }

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return respond({ error: 'Request failed' }, 401)
    const { data: { user }, error: userError } = await admin.auth.getUser(token)
    if (userError || !user) return respond({ error: 'Request failed' }, 401)
    const { data: member, error: memberError } = await admin.from('family_members')
      .select('family_id,role').eq('user_id', user.id).maybeSingle()
    check(memberError)
    if (!member || member.role !== 'parent') return respond({ error: 'Request failed' }, 403)

    if (body.action === 'change-password') {
      if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128)
        return respond({ error: 'Request failed' }, 400)
      // Auth getUser validates the current session, admin updates password and app metadata together.
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password: body.password,
        app_metadata: { ...user.app_metadata, must_change_password: false },
      })
      check(error)
      return respond({ ok: true })
    }
    if (user.app_metadata.must_change_password) return respond({ error: 'Request failed' }, 403)
    if (typeof body.childId !== 'string' || !body.childId || body.childId.length > 128)
      return respond({ error: 'Request failed' }, 400)

    if (body.action === 'delete') {
      const { data: child, error } = await admin.from('family_members').select('user_id')
        .eq('family_id', member.family_id).eq('role', 'child').eq('child_id', body.childId).maybeSingle()
      check(error)
      if (child) {
        // Cascading membership/login deletion also blocks already-issued child sessions at RPC gate.
        const { error: deleteError } = await admin.auth.admin.deleteUser(child.user_id)
        check(deleteError)
      }
      return respond({ ok: true })
    }
    if (body.action !== 'provision') return respond({ error: 'Request failed' }, 400)
    const { data: family, error: familyError } = await admin.from('families').select('state')
      .eq('id', member.family_id).single()
    check(familyError)
    if (!family || !family.state.profiles.some((profile: { id: string }) => profile.id === body.childId))
      return respond({ error: 'Request failed' }, 400)
    const { data: existing, error: existingError } = await admin.from('family_members').select('user_id')
      .eq('family_id', member.family_id).eq('child_id', body.childId).maybeSingle()
    check(existingError)
    if (existing) return respond({ error: 'Request failed' }, 400)
    const code = randomString(16)
    const password = randomString(40)
    const email = `child-${crypto.randomUUID()}@children.ukelonn.invalid`
    const codeHash = await hash(`code:${code}`)
    const ciphertext = await encrypt(password)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { account_type: 'child' },
    })
    check(createError)
    if (!created.user) throw new Error('Account creation failed')
    const { error: provisionError } = await admin.rpc('provision_child_member', {
      p_parent_id: user.id, p_user_id: created.user.id, p_child_id: body.childId,
      p_code_hash: codeHash, p_email: email, p_password_ciphertext: ciphertext,
    })
    if (provisionError) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id)
      check(cleanupError)
      throw new Error('Provisioning failed')
    }
    return respond({ code })
  } catch {
    // Deliberately generic; never log codes, passwords, tokens or Auth response payloads.
    return respond({ error: 'Request failed' }, 400)
  }
})
