# Ukelønn pilot cloud backend

This is per-family JSON snapshot persistence and Supabase Auth, not scheduled server
settlement, payroll, a real bank, or bank transfers. Existing finance logic remains in
the app. No project, deployment or real users have been created by this change.

**Pilot limitation:** completed-period salary settlement and credited bank
interest are calculated lazily by a parent client, not this backend. If only a
child opens the app after a boundary, older periods/balances stay unsettled
until a parent opens the app and successfully saves the calculated snapshot.
Child current-period entries still use the server calendar. Do not present
this pilot as automatic payroll across unseen periods. Shared client finance
helpers currently use the device's local calendar: keep parent pilot devices
in Europe/Oslo; arbitrary-timezone settlement needs a subsequent coordinated
server/timezone implementation.

## Setup

1. Create a Supabase project yourself. Use production HTTPS for iPhone/Android.
   Apply `migrations/202611010001_family_backend.sql` in the SQL editor or run
   `supabase link --project-ref YOUR_REF` and `supabase db push` after reviewing it.
   This migration is intended for a new project; do not reapply it manually.
   For an existing project, also apply the incremental
   `migrations/202611030001_bonus_task_recurrence.sql` migration in the SQL
   editor (or with `supabase db push`) to enforce one-period bonus-task expiry.
2. Enable email/password Auth; disable public signup. Configure reliable SMTP and
   email recovery templates. Set Auth Site URL to the app HTTPS origin and allow
   the exact app URL under redirect URLs (plus localhost only for development).
   Password minimum should be at least 12 characters. Auth providers and redirect
   settings are dashboard setup, not automatically modified by this repository.
3. Generate a private random `CHILD_CODE_PEPPER` of at least 32 characters with
   `openssl rand -hex 32`. Store it in your password manager and Supabase secrets,
   not in source or Vite env. Set `ALLOWED_ORIGINS` to a comma-separated exact
   origin list, e.g. your HTTPS app origin and `http://localhost:5173`.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to hosted functions
   by Supabase. From the repository root, deploy with
   `npx supabase functions deploy child-login --use-api` (no Docker required).
   The function configuration explicitly references `functions/deno.json` as
   its import map so hosted bundling resolves `@supabase/supabase-js`.
   `verify_jwt=false` is intentional: public child login must work, and the
   function explicitly validates Supabase Auth sessions for every parent action.
4. Copy `.env.example` to `.env.local` yourself. Supply only the project URL and
   publishable key. Never put service keys or the pepper in `VITE_*`. The wrapper
   renders legacy local App only when both cloud variables are absent. If only
   one is supplied, a configuration error is shown instead. Configured cloud
   failures never load a local family snapshot.
5. Build and host the app using your existing workflow. On iPhone use Safari's
   Add to Home Screen; Android Chrome supports app installation. Log into the
   same family on each device; state refreshes every 10 seconds and on focus.
   Internet is required for cloud mutations; there is no offline write queue.

## Create one or more families

Create your own **gitignored** `families.local` containing a JSON array with at
least one object shaped `{"email":"REAL_PARENT_EMAIL"}`. Use real deliverable
addresses, not example domains. No input containing actual emails is included
in this repo.

```sh
node scripts/create-families.mjs --input families.local --validate
# Supply these variables securely in your shell, not source or browser env:
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
node scripts/create-families.mjs --input families.local --credentials credentials.local
```

You can start with one family. To add families later, append their email
addresses to the same `families.local` list and rerun the command with the same
`credentials.local` file. Keep all previously provisioned addresses in the
input; the script rejects a credential file if the input omits one of its
families. The script does not impose a fixed family count.

The `.local` suffix is already gitignored. Output must be explicitly specified,
inside this repository, and gitignored before the command runs. It is created
with mode `0600`; existing output must also be private. Credentials never appear
on stdout/stderr. Share each parent's own temporary password through a secure
channel only. Protect/delete this file after onboarding; it contains the original
temporary passwords, which become invalid once changed. Do not commit it.

The script creates one separate family per email, initially with no child
profiles (create them as the parent after changing the password), is
resumable/idempotent with the same input and output, never overwrites
snapshots/passwords on reruns, and refuses to adopt unrelated existing Auth
users. Run only one provisioning script at once.
If interrupted, rerun with the same credentials file. If that file is lost, use
dashboard recovery instead of trying to recover temporary passwords. Creation
uses confirmed emails; the script does not send invitation emails.

On request failure, the script reports the affected service (Auth or database)
and HTTP status, or a sanitized network/response error. Response bodies and
credentials are never printed. Keep the same private credentials file when
retrying; do not delete it to work around a provisioning failure.

`must_change_password` is set in **app_metadata**. SQL checks authoritative Auth
metadata and denies all family access until the authenticated parent uses the
edge `change-password` action. Browser password edits or user_metadata edits
cannot clear the gate. Password recovery follows the email link back to the
wrapper and uses that same action. To administratively reset a parent, use
Supabase Authentication → Users → the parent → send password recovery (dashboard
wording may vary), or securely set a new temporary password and
`app_metadata.must_change_password=true` using Supabase's trusted Admin API.
Never modify membership to bypass the password gate.

## Integration contract

`src/lib/backend.ts` exports `CloudContext`, `FamilySnapshot`, `cloudEnabled`, `cloudConfigurationError`,
`supabase`, `requireBackend`, `decodeSnapshot`, `familyRpc`, `loginAction`,
and `signInChild`. `CloudApp` owns Auth subscription, recovery, snapshots and
errors; `main.tsx` renders it. The agreed App entry is:

```ts
App({ cloud }: { cloud?: CloudContext })
```

App must treat `cloud.state` as authoritative, use `cloud.role`/`childId` for UI
only, and route mutations through the asynchronous CloudContext functions. Do
not settle/save child state locally, use local passwords/PINs in cloud mode, or
silently persist a failed mutation. Parent saves return a new server snapshot;
the wrapper sends its base revision and stale saves are rejected. Retry only
after fetching/reviewing the latest state, not automatically rebasing financial
changes. Registration/removal RPCs are for children only; parents change the
snapshot with `saveState`. Remove a child's login **before** deleting its profile.
Generate/show a child code once, deliver it privately, and never save it into
AppState. `CloudContext.createChildLogin` explicitly deletes an existing login
before provisioning the replacement, so App must warn/confirm rotation first.
If provisioning then fails, the old code is already revoked; display the error
and retry generation. The edge `provision` action by itself rejects an existing
login, rather than silently rotating. Logout failures are visible.
Parent account actions refresh the Auth session before invoking the function
and explicitly send the fresh token. A failed refresh prevents the action;
a rejected session displays a sign-out/sign-in instruction. Mutations are
never automatically retried after a failed function request.

RPCs use these named arguments:

| RPC | Arguments |
|---|---|
| `get_family_state` | none |
| `save_family_state` | `p_state`, `p_expected_revision` |
| `register_child_entry` | `p_task_type` (`mandatory`/`bonus`), `p_task_id` |
| `remove_child_entry` | `p_entry_id` |

All return `{state,revision,role,childId}`. Roles come from `family_members`, not
the browser. Direct authenticated table access has no RLS policy and is denied;
the security-definer RPCs explicitly authorize membership and role. Child reads
contain only their own profile, plus stripped parent configuration, not sibling
balances/history. Child responses additionally include optional
`state.sharedBonusClaims: {taskName, points, timestamp, childName}[]` for **other**
children's current-period shared tasks matching the logged-in child's assigned
upForGrabs name/points. This derived availability metadata is never persisted
and contains no sibling financial data. Credentials are stripped recursively for **all** reads/saves.
The TS adapter restores null/empty legacy credential fields to satisfy AppState,
without reintroducing any usable credentials.

Children can append/remove only their own current-period mandatory/bonus
entries, capped by requiredCount/one bonus; penalties, money, allowance, salary,
bank fields and historic entries cannot be changed by child RPCs. Server-generated
IDs/timestamps use the Europe/Oslo calendar (Monday weekly boundary).
New bonus tasks may be marked to repeat each pay period; unmarked tasks are
available only in the creation period, enforced by the
`202611030001_bonus_task_recurrence.sql` database migration. Existing bonus
tasks without recurrence metadata remain available each period.
Entries include server snapshots of `periodType`, `taskName` and `points`.
`upForGrabs` is matched across the family by trimmed case-insensitive task
name + numeric points, consistent with the existing task identity convention;
checks and writes hold one family row lock. For mixed weekly/monthly profiles,
each profile's own current period is checked. `bonusRequiresMandatory` gates
client-parent salary payout, **not** child bonus registration: children may
register/keep bonus points before completing mandatory chores.

Child codes are 16 random unambiguous letters/digits. Only a keyed HMAC lookup
and AES-GCM-encrypted Auth password are stored server-side, and the service key
never reaches the browser. Supabase Auth issues and verifies all tokens; there
is no bespoke JWT implementation. Login errors are generic. The function uses
database counters: 5 attempts/code, 10/IP, 600 globally per 15-minute window.
Rate limiting assumes the hosted gateway supplies trustworthy `x-forwarded-for`;
verify proxy header behavior in your deployment, use gateway/WAF IP limiting too
if that guarantee does not hold. The global/code limits remain enforced if IP
headers are spoofed. Changing/loss of the pepper invalidates all existing child
logins; delete/provision codes again. Child codes are bearer secrets: share only
with the intended child and revoke if leaked.

## Manual smoke tests (requires your own deployed project)

Local syntax checks are not proof that remote SQL/Auth/SMTP works. Run these
before inviting the pilot families; use only disposable pilot records:

1. **Family isolation:** validate one or more unique input emails; provision
   once and rerun, then add a family and rerun with the expanded input. Verify
   each family has one parent membership and existing families have unchanged
   snapshots and no duplicated users. Family A cannot see or change B.
2. **First password:** temporary password logs in but every RPC rejects
   `PASSWORD_CHANGE_REQUIRED`. Change via wrapper; then RPC works. Attempt to
   clear user_metadata/browser role; gate remains. Old password fails.
3. **Parent recovery:** request reset, follow received link on both desktop and
   phone, set new password, log out/in. Check invalid/expired links display
   failures. Confirm configured redirect and SMTP deliverability.
4. **Cross-device persistence:** parent A creates/configures a child on desktop;
   same parent sees it on Safari iPhone and Chrome Android after focus/10s.
   Different parent sees no profile. A failed network request shows an error.
5. **Child lifecycle:** generate code once; child signs in on both phones,
   sees only own profile. UI generation rotates the existing login after warning;
   direct edge provision without deletion fails. Delete invalidates code and
   an already-issued session's RPC access. Fresh code works.
6. **Child authorization:** with a child's actual token, call save RPC/direct
   table writes, penalty registration and another child's IDs. All fail; salary,
   allowance, bank, settlements and penalties remain identical.
7. **Limits/current period:** mandatory registration stops at requiredCount;
   bonus stops at one but can register before mandatory chores are done. Confirm
   configured mandatory gating applies to salary payout, not point registration. Own current entry
   removes; old-period/penalty/sibling entry cannot remove. Test Oslo boundaries.
8. **Global concurrency:** two different children simultaneously claim the
   same upForGrabs task. Exactly one succeeds and family revision increases
   once. The other child's refreshed sharedBonusClaims shows claimant name/time
   without sibling balances. Removing that entry allows another current-period claim.
9. **CAS concurrency:** fetch revision N in two parent tabs; first save
   succeeds, second call explicitly using N returns STALE_REVISION. Snapshot
   must preserve the winner. A child mutation also invalidates old parent CAS.
10. **Secrets/rate limits:** verify parent/child RPC responses and stored state
   omit local credential fields; authenticated direct login-table reads fail.
   Wrong codes produce generic errors; test limits across instances/concurrent
   requests. Unauthenticated provision/delete/password changes fail. Inspect
   browser network/build output for no service key/pepper/plain Auth password.

Local checks: `node --check scripts/create-families.mjs`,
`node --test scripts/backend-contract.check.mjs`, and the existing TypeScript
build. Deno code lives outside app `src` and has its own `deno.json`; when Deno
is installed, run `deno check --config supabase/functions/deno.json
supabase/functions/child-login/index.ts`. Review/apply SQL and run the above
remote tests manually; no remote validation is claimed here.
