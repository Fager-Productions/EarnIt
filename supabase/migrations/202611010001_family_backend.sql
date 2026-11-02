create extension if not exists pgcrypto with schema extensions;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  pilot_key text unique,
  state jsonb not null default '{"profiles":[],"activeChildId":"","parentSettings":{"penaltyEnabled":false,"bonusRequiresMandatory":true,"interestRatePct":0,"interestPeriod":"month"}}',
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent', 'child')),
  child_id text,
  check ((role = 'parent' and child_id is null) or (role = 'child' and child_id is not null)),
  unique (family_id, child_id)
);

-- Only the service role can access login mapping or rate-limit records.
create table public.child_logins (
  user_id uuid primary key references public.family_members(user_id) on delete cascade,
  code_hash text not null unique,
  email text not null unique,
  password_ciphertext text not null
);
create table public.login_attempts (
  bucket text primary key,
  window_start timestamptz not null,
  attempts integer not null
);

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.child_logins enable row level security;
alter table public.login_attempts enable row level security;
revoke all on public.families, public.family_members, public.child_logins, public.login_attempts from anon, authenticated;
grant all on public.families, public.family_members, public.child_logins, public.login_attempts to service_role;

create function public.current_family_member() returns public.family_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.family_members;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  -- Read authoritative metadata, not cached/browser-supplied role or JWT metadata.
  if not exists (select 1 from auth.users where id = auth.uid()
    and coalesce((raw_app_meta_data->>'must_change_password')::boolean, false) = false) then
    raise exception 'PASSWORD_CHANGE_REQUIRED';
  end if;
  select * into m from public.family_members where user_id = auth.uid();
  if not found then raise exception 'FAMILY_ACCESS_DENIED'; end if;
  return m;
end $$;

create function public.strip_credentials(value jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare result jsonb; k text; v jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    result := '{}'::jsonb;
    for k, v in select * from jsonb_each(value) loop
      if lower(k) !~ '(password|pin|parentaccounts|legacy|credential|secret|token|salt|hash)' then
        result := result || jsonb_build_object(k, public.strip_credentials(v));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(public.strip_credentials(e)), '[]'::jsonb) into result
      from jsonb_array_elements(value) e;
    return result;
  end if;
  return value;
end $$;

create function public.period_start(p_type text, p_time timestamptz) returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select date_trunc(case when p_type = 'month' then 'month' else 'week' end,
    p_time at time zone 'Europe/Oslo') at time zone 'Europe/Oslo'
$$;

create function public.family_response(f public.families, m public.family_members) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare s jsonb := public.strip_credentials(f.state) - 'sharedBonusClaims';
begin
  if m.role = 'child' then
    s := s || jsonb_build_object('sharedBonusClaims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskName', coalesce(e->>'taskName', t->>'name'),
        'points', coalesce(e->'points', t->'points'),
        'timestamp', e->'timestamp', 'childName', p->>'childName'))
      from jsonb_array_elements(s->'profiles') p
      cross join lateral jsonb_array_elements(p->'bonusTasks') t
      cross join lateral jsonb_array_elements(p->'entries') e
      where p->>'id' <> m.child_id and coalesce((t->>'upForGrabs')::boolean, false)
        and e->>'taskType' = 'bonus' and e->>'taskId' = t->>'id'
        and coalesce(e->>'periodType', p->>'periodType') = p->>'periodType'
        and (e->>'timestamp')::timestamptz >= public.period_start(p->>'periodType', statement_timestamp())
        and (e->>'timestamp')::timestamptz <= statement_timestamp()
        and exists (
          select 1 from jsonb_array_elements(s->'profiles') own
          cross join lateral jsonb_array_elements(own->'bonusTasks') assigned
          where own->>'id' = m.child_id and coalesce((assigned->>'upForGrabs')::boolean, false)
            and lower(btrim(assigned->>'name')) = lower(btrim(coalesce(e->>'taskName', t->>'name')))
            and (assigned->>'points')::numeric = coalesce(e->>'points', t->>'points')::numeric
        )
    ), '[]'::jsonb));
    -- Never expose siblings' bank/history/profile data. Global task availability is enforced by RPC.
    s := jsonb_set(s, '{profiles}', coalesce(
      (select jsonb_agg(p) from jsonb_array_elements(s->'profiles') p where p->>'id' = m.child_id), '[]'::jsonb));
    s := jsonb_set(s, '{activeChildId}', to_jsonb(m.child_id));
  end if;
  return jsonb_build_object('state', s, 'revision', f.revision, 'role', m.role, 'childId', m.child_id);
end $$;

create function public.get_family_state() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.family_members := public.current_family_member(); f public.families;
begin
  select * into strict f from public.families where id = m.family_id;
  return public.family_response(f, m);
end $$;

create function public.save_family_state(p_state jsonb, p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.family_members := public.current_family_member(); f public.families; clean jsonb;
begin
  if m.role <> 'parent' then raise exception 'PARENT_REQUIRED'; end if;
  clean := public.strip_credentials(p_state) - 'sharedBonusClaims';
  if jsonb_typeof(clean) <> 'object' or jsonb_typeof(clean->'profiles') is distinct from 'array'
    or jsonb_typeof(clean->'parentSettings') is distinct from 'object'
    or jsonb_array_length(clean->'profiles') > 50 or octet_length(clean::text) > 2000000 then
    raise exception 'INVALID_STATE';
  end if;
  if exists (select 1 from jsonb_array_elements(clean->'profiles') p
    where jsonb_typeof(p) <> 'object' or coalesce(p->>'id', '') = ''
      or coalesce(p->>'periodType', '') not in ('week', 'month')
      or jsonb_typeof(p->'entries') is distinct from 'array'
      or jsonb_typeof(p->'mandatoryTasks') is distinct from 'array'
      or jsonb_typeof(p->'bonusTasks') is distinct from 'array')
    or (select count(*) <> count(distinct p->>'id') from jsonb_array_elements(clean->'profiles') p) then
    raise exception 'INVALID_PROFILES';
  end if;
  select * into strict f from public.families where id = m.family_id for update;
  if p_expected_revision is null or f.revision <> p_expected_revision then
    raise exception 'STALE_REVISION: Hent nyeste data før du prøver igjen';
  end if;
  if exists (select 1 from public.family_members c where c.family_id = m.family_id and c.role = 'child'
    and not exists (select 1 from jsonb_array_elements(clean->'profiles') p where p->>'id' = c.child_id)) then
    raise exception 'DELETE_CHILD_LOGIN_BEFORE_PROFILE';
  end if;
  update public.families set state = clean, revision = revision + 1, updated_at = now()
    where id = m.family_id returning * into f;
  return public.family_response(f, m);
end $$;

create function public.register_child_entry(p_task_type text, p_task_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.family_members := public.current_family_member(); f public.families;
  profile jsonb; task jsonb; entries jsonb; idx integer; n integer; period timestamptz;
  stamp timestamptz := statement_timestamp(); required integer;
begin
  if m.role <> 'child' then raise exception 'CHILD_REQUIRED'; end if;
  if p_task_type is null or p_task_type not in ('mandatory', 'bonus') then raise exception 'INVALID_TASK_TYPE'; end if;
  select * into strict f from public.families where id = m.family_id for update;
  select p, (ordinality - 1)::integer into profile, idx
    from jsonb_array_elements(f.state->'profiles') with ordinality as x(p, ordinality)
    where p->>'id' = m.child_id;
  if profile is null then raise exception 'CHILD_NOT_FOUND'; end if;
  period := public.period_start(profile->>'periodType', stamp);
  select t into task from jsonb_array_elements(profile->(p_task_type || 'Tasks')) t where t->>'id' = p_task_id;
  if task is null then raise exception 'TASK_NOT_FOUND'; end if;
  entries := profile->'entries';
  select count(*) into n from jsonb_array_elements(entries) e
    where e->>'taskType' = p_task_type and e->>'taskId' = p_task_id
    and coalesce(e->>'periodType', profile->>'periodType') = profile->>'periodType'
    and (e->>'timestamp')::timestamptz >= period and (e->>'timestamp')::timestamptz <= stamp;
  required := case when p_task_type = 'mandatory' then (task->>'requiredCount')::integer else 1 end;
  if required is null or required < 1 or n >= required then raise exception 'TASK_LIMIT_REACHED'; end if;
  if p_task_type = 'bonus' and coalesce((task->>'upForGrabs')::boolean, false) and exists (
    select 1 from jsonb_array_elements(f.state->'profiles') p
    cross join lateral jsonb_array_elements(p->'bonusTasks') t
    cross join lateral jsonb_array_elements(p->'entries') e
    where lower(btrim(coalesce(e->>'taskName', t->>'name'))) = lower(btrim(task->>'name'))
      and coalesce(e->>'points', t->>'points')::numeric = (task->>'points')::numeric
      and e->>'taskType' = 'bonus' and e->>'taskId' = t->>'id'
      and coalesce(e->>'periodType', p->>'periodType') = p->>'periodType'
      and (e->>'timestamp')::timestamptz >= public.period_start(p->>'periodType', stamp)
      and (e->>'timestamp')::timestamptz <= stamp
  ) then raise exception 'BONUS_ALREADY_CLAIMED'; end if;
  entries := entries || jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid()::text, 'taskType', p_task_type, 'taskId', p_task_id, 'timestamp', stamp,
    'periodType', profile->>'periodType', 'taskName', task->>'name',
    'points', case when p_task_type = 'bonus' then (task->>'points')::numeric else 0 end));
  update public.families set
    state = jsonb_set(state, array['profiles', idx::text, 'entries'], entries),
    revision = revision + 1, updated_at = now()
    where id = m.family_id returning * into f;
  return public.family_response(f, m);
end $$;

create function public.remove_child_entry(p_entry_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.family_members := public.current_family_member(); f public.families;
  profile jsonb; entry jsonb; entries jsonb; idx integer; stamp timestamptz := statement_timestamp();
begin
  if m.role <> 'child' then raise exception 'CHILD_REQUIRED'; end if;
  select * into strict f from public.families where id = m.family_id for update;
  select p, (ordinality - 1)::integer into profile, idx
    from jsonb_array_elements(f.state->'profiles') with ordinality as x(p, ordinality)
    where p->>'id' = m.child_id;
  if profile is null then raise exception 'CHILD_NOT_FOUND'; end if;
  select e into entry from jsonb_array_elements(profile->'entries') e where e->>'id' = p_entry_id;
  if entry is null or coalesce(entry->>'taskType', '') not in ('mandatory', 'bonus')
    or entry->>'timestamp' is null
    or coalesce(entry->>'periodType', profile->>'periodType') <> profile->>'periodType'
    or (entry->>'timestamp')::timestamptz < public.period_start(profile->>'periodType', stamp)
    or (entry->>'timestamp')::timestamptz > stamp then raise exception 'ENTRY_REMOVAL_DENIED'; end if;
  select coalesce(jsonb_agg(e), '[]'::jsonb) into entries
    from jsonb_array_elements(profile->'entries') e where e->>'id' <> p_entry_id;
  update public.families set state = jsonb_set(state, array['profiles', idx::text, 'entries'], entries),
    revision = revision + 1, updated_at = now() where id = m.family_id returning * into f;
  return public.family_response(f, m);
end $$;

-- All counters are serialized; a global cap also bounds unauthenticated storage growth.
create function public.consume_login_attempt(p_ip_hash text, p_code_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text; cap integer; used integer; stamp timestamptz := clock_timestamp();
begin
  for k, cap in select * from (values ('global', 600), ('ip:' || p_ip_hash, 10), ('code:' || p_code_hash, 5)) v loop
    insert into public.login_attempts(bucket, window_start, attempts) values (k, stamp, 1)
    on conflict (bucket) do update set
      attempts = case when login_attempts.window_start < stamp - interval '15 minutes' then 1 else login_attempts.attempts + 1 end,
      window_start = case when login_attempts.window_start < stamp - interval '15 minutes' then stamp else login_attempts.window_start end
    returning attempts into used;
    if used > cap then return false; end if;
  end loop;
  delete from public.login_attempts where window_start < stamp - interval '1 day';
  return true;
end $$;

-- Service-only member insertion checks the parent again and locks the same family row as saves.
create function public.provision_child_member(p_parent_id uuid, p_user_id uuid, p_child_id text,
  p_code_hash text, p_email text, p_password_ciphertext text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare fid uuid;
begin
  select family_id into fid from public.family_members where user_id = p_parent_id and role = 'parent';
  if fid is null or not exists (select 1 from auth.users where id = p_parent_id
    and coalesce((raw_app_meta_data->>'must_change_password')::boolean, false) = false) then
    raise exception 'PARENT_REQUIRED';
  end if;
  perform 1 from public.families where id = fid for update;
  if not exists (select 1 from public.families f cross join lateral jsonb_array_elements(f.state->'profiles') p
    where f.id = fid and p->>'id' = p_child_id) then raise exception 'CHILD_NOT_FOUND'; end if;
  insert into public.family_members values (p_user_id, fid, 'child', p_child_id);
  insert into public.child_logins values (p_user_id, p_code_hash, p_email, p_password_ciphertext);
end $$;

-- No table policies intentionally: authenticated users can access only the role-gated RPCs.
revoke execute on function public.current_family_member(), public.strip_credentials(jsonb),
  public.family_response(public.families, public.family_members), public.period_start(text, timestamptz),
  public.get_family_state(), public.save_family_state(jsonb, bigint),
  public.register_child_entry(text, text), public.remove_child_entry(text),
  public.consume_login_attempt(text, text),
  public.provision_child_member(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.get_family_state(), public.save_family_state(jsonb, bigint),
  public.register_child_entry(text, text), public.remove_child_entry(text) to authenticated;
grant execute on function public.consume_login_attempt(text, text),
  public.provision_child_member(uuid, uuid, text, text, text, text) to service_role;
