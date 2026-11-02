import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { supabaseRequest, validateFamilies } from './create-families.mjs'

test('provisioning sends administrative headers and reads successful responses', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ users: [] }))
  assert.deepEqual(await supabaseRequest('https://project.invalid', 'test-key', '/auth/v1/admin/users'), { users: [] })
  const [url, options] = fetch.mock.calls[0].arguments
  assert.equal(url, 'https://project.invalid/auth/v1/admin/users')
  assert.equal(options.headers.apikey, 'test-key')
  assert.equal(options.headers.Authorization, 'Bearer test-key')
})

test('provisioning reports HTTP status without exposing response bodies or credentials', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private response', { status: 401 }))
  await assert.rejects(supabaseRequest('https://project.invalid', 'private-key', '/auth/v1/admin/users'), error => {
    assert.match(error.message, /Auth.*HTTP 401.*service_role/)
    assert.doesNotMatch(error.message, /private response|private-key/)
    return true
  })
})

test('provisioning sanitizes network errors and invalid JSON responses', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('private-key') })
  await assert.rejects(supabaseRequest('https://project.invalid', 'private-key', '/rest/v1/families'),
    /Supabase database: network request failed/)
  fetch.mock.mockImplementation(async () => new Response('private-key'))
  await assert.rejects(supabaseRequest('https://project.invalid', 'private-key', '/rest/v1/families'),
    /Supabase database: could not read a valid JSON response/)
})

test('child-login deployment explicitly resolves its Supabase package import', async () => {
  const configUrl = new URL('../supabase/config.toml', import.meta.url)
  const config = await readFile(configUrl, 'utf8')
  const functionConfig = config.match(/\[functions\.child-login\]([\s\S]*?)(?=\n\[|$)/)?.[1]
  assert.ok(functionConfig, 'child-login must have deployment configuration')
  const importMapPath = functionConfig.match(/^import_map\s*=\s*"([^"]+)"/m)?.[1]
  assert.ok(importMapPath, 'deployment must explicitly reference an import map')
  const importMap = JSON.parse(await readFile(new URL(importMapPath, configUrl), 'utf8'))
  assert.match(importMap.imports['@supabase/supabase-js'], /^npm:@supabase\/supabase-js@\d+\.\d+\.\d+$/)
})

test('accepts one family and allows adding families later', () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({ email: `parent${index}@pilot-mail.org` }))
  assert.equal(validateFamilies(rows.slice(0, 1)).length, 1)
  assert.equal(validateFamilies(rows).length, 11)
  assert.throws(() => validateFamilies([]))
})
test('duplicates are case-insensitive and placeholder domains are rejected', () => {
  assert.throws(() => validateFamilies([
    { email: 'parent@pilot-mail.org' },
    { email: 'PARENT@pilot-mail.org' },
  ]))
  assert.throws(() => validateFamilies([{ email: 'parent@example.com' }]))
})
