#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, open, lstat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

class ProvisioningError extends Error {}

export async function supabaseRequest(url, key, path, options = {}) {
  const service = path.startsWith('/auth/') ? 'Auth' : 'database'
  let response
  try {
    response = await fetch(`${url}${path}`, {
      ...options,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        ...options.headers },
    })
  } catch {
    throw new ProvisioningError(`Supabase ${service}: network request failed. Check the project URL, internet connection and key format.`)
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403
      ? 'Check that the service_role key belongs to this project and has administrative access.'
      : service === 'database'
        ? 'Check that the backend migration was applied and the Data API is enabled.'
        : 'Check Authentication settings and Auth logs in the dashboard.'
    throw new ProvisioningError(`Supabase ${service} request failed (HTTP ${response.status}). ${hint}`)
  }
  try {
    const text = await response.text()
    return text ? JSON.parse(text) : null
  } catch {
    throw new ProvisioningError(`Supabase ${service}: could not read a valid JSON response.`)
  }
}

export function validateFamilies(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Input must contain at least one family.')
  const families = input.map(row => {
    if (!row || typeof row.email !== 'string') throw new Error('Every family needs a real parent email.')
    const email = row.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || /\.(invalid|example|test|localhost)$/.test(email)
      || /@(?:example\.(?:com|org|net))$/.test(email)) throw new Error('Use real deliverable email addresses.')
    return { email }
  })
  if (new Set(families.map(row => row.email)).size !== families.length) throw new Error('All family emails must be unique.')
  return families
}

async function main() {
  const args = process.argv.slice(2)
  const inputIndex = args.indexOf('--input')
  const outputIndex = args.indexOf('--credentials')
  if (inputIndex < 0 || !args[inputIndex + 1]) {
    throw new Error('Usage: node scripts/create-families.mjs --input families.local --credentials credentials.local [--validate]')
  }
  const families = validateFamilies(JSON.parse(await readFile(resolve(args[inputIndex + 1]), 'utf8')))
  if (args.includes('--validate')) {
    console.log(`Validated ${families.length} unique parent email${families.length === 1 ? '' : 's'}. No external requests made.`)
    return
  }
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('An explicit --credentials output file is required.')
  const output = resolve(args[outputIndex + 1])
  const root = process.cwd()
  if (!output.startsWith(`${root}/`) || output === resolve(args[inputIndex + 1])) {
    throw new Error('Credential output must be inside this repository and different from input.')
  }
  try { execFileSync('git', ['check-ignore', '--quiet', output], { stdio: 'ignore' }) }
  catch { throw new Error('Credential output must already be gitignored (use credentials.local).') }
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !/^https:\/\//.test(url) || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, never VITE service credentials.')

  let records
  try {
    const handle = await open(output, 'wx', 0o600)
    await handle.close()
    records = { version: 1, families: [] }
    await writeFile(output, JSON.stringify(records, null, 2), { mode: 0o600 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const info = await lstat(output)
    if ((info.mode & 0o777) !== 0o600 || !info.isFile()) throw new Error('Credential file must be a regular file with mode 0600.')
    records = JSON.parse(await readFile(output, 'utf8'))
    if (records.version !== 1 || !Array.isArray(records.families)) throw new Error('Invalid credential resume file.')
  }
  if (records.families.some(row => !families.some(family => family.email === row.email))) {
    throw new Error('Resume file contains families missing from this input; include all previously provisioned emails.')
  }
  const persist = () => writeFile(output, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })

  async function request(path, options = {}) {
    return supabaseRequest(url, key, path, options)
  }
  const users = []
  for (let page = 1; ; page++) {
    const result = await request(`/auth/v1/admin/users?page=${page}&per_page=1000`)
    users.push(...result.users)
    if (result.users.length < 1000) break
  }
  for (const family of families) {
    const pilotKey = `ukelonn-pilot:${family.email}`
    let record = records.families.find(row => row.email === family.email)
    let user = users.find(row => row.email?.toLowerCase() === family.email)
    if (user && user.app_metadata?.pilot_key !== pilotKey) {
      throw new Error('A requested email already belongs to a non-pilot account; refusing to modify it.')
    }
    if (!record) {
      if (user) throw new Error('Existing pilot account has no matching credential resume file; use dashboard recovery, not this provisioning script.')
      record = { email: family.email, temporaryPassword: randomBytes(24).toString('base64url'), status: 'pending' }
      records.families.push(record)
      await persist() // Persist before Auth creation so interrupted runs retain the password.
    }
    if (!user) {
      if (record.status === 'complete') throw new Error('A completed pilot user was deleted; use a new explicit input/resume file.')
      user = await request('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: family.email, password: record.temporaryPassword, email_confirm: true,
          app_metadata: { pilot_key: pilotKey, must_change_password: true },
        }),
      })
      users.push(user)
    }
    const existing = await request(`/rest/v1/families?pilot_key=eq.${encodeURIComponent(pilotKey)}&select=id`)
    const rows = existing.length ? existing : await request('/rest/v1/families', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ pilot_key: pilotKey }),
    })
    const familyId = rows[0].id
    const membership = await request(`/rest/v1/family_members?user_id=eq.${user.id}&select=family_id,role`)
    if (membership.length && (membership[0].family_id !== familyId || membership[0].role !== 'parent')) {
      throw new Error('Existing membership does not match the pilot family.')
    }
    if (!membership.length) await request('/rest/v1/family_members', {
      method: 'POST', body: JSON.stringify({ user_id: user.id, family_id: familyId, role: 'parent' }),
    })
    record.userId = user.id
    record.familyId = familyId
    record.status = 'complete'
    await persist()
  }
  console.log(`${families.length} famil${families.length === 1 ? 'y' : 'ies'} provisioned or verified. Credentials written only to the specified private file.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Native JSON/network errors can include response snippets containing secrets.
    if (error instanceof ProvisioningError) console.error(error.message)
    console.error('Family provisioning failed. Check input, private output file, environment and dashboard. Rerun with the same output file; no credentials were printed.')
    process.exitCode = 1
  })
}
