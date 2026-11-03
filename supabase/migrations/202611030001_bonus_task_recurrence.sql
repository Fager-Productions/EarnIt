create or replace function public.register_child_entry(p_task_type text, p_task_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m public.family_members := public.current_family_member(); f public.families;
  profile jsonb; task jsonb; entries jsonb; idx integer; n integer; period timestamptz;
  stamp timestamptz := statement_timestamp(); required integer; current_period_key text;
begin
  if m.role <> 'child' then raise exception 'CHILD_REQUIRED'; end if;
  if p_task_type is null or p_task_type not in ('mandatory', 'bonus') then raise exception 'INVALID_TASK_TYPE'; end if;
  select * into strict f from public.families where id = m.family_id for update;
  select p, (ordinality - 1)::integer into profile, idx
    from jsonb_array_elements(f.state->'profiles') with ordinality as x(p, ordinality)
    where p->>'id' = m.child_id;
  if profile is null then raise exception 'CHILD_NOT_FOUND'; end if;
  period := public.period_start(profile->>'periodType', stamp);
  current_period_key := case when profile->>'periodType' = 'week'
    then to_char(stamp at time zone 'Europe/Oslo', 'IYYY-"W"IW')
    else to_char(stamp at time zone 'Europe/Oslo', 'YYYY-MM') end;
  select t into task from jsonb_array_elements(profile->(p_task_type || 'Tasks')) t where t->>'id' = p_task_id;
  if task is null then raise exception 'TASK_NOT_FOUND'; end if;
  if p_task_type = 'bonus' and coalesce((task->>'repeatEachPeriod')::boolean, true) = false
    and task->>'createdPeriodKey' is not null
    and task->>'createdPeriodKey' is distinct from current_period_key then
    raise exception 'TASK_PERIOD_EXPIRED';
  end if;
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
