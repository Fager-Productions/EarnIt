create or replace function public.family_response(f public.families, m public.family_members) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare s jsonb := public.strip_credentials(f.state) - 'sharedBonusClaims';
begin
  if m.role = 'child' then
    s := s || jsonb_build_object('sharedBonusClaims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskName', coalesce(e->>'taskName', t->>'name'),
        'points', coalesce(e->'points', t->'points'),
        'timestamp', e->'timestamp',
        'childName', case when coalesce((s #>> '{parentSettings,showSharedTaskClaimant}')::boolean, true)
          then p->>'childName' else '' end))
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
    s := jsonb_set(s, '{profiles}', coalesce(
      (select jsonb_agg(p) from jsonb_array_elements(s->'profiles') p where p->>'id' = m.child_id), '[]'::jsonb));
    s := jsonb_set(s, '{activeChildId}', to_jsonb(m.child_id));
  end if;
  return jsonb_build_object('state', s, 'revision', f.revision, 'role', m.role, 'childId', m.child_id);
end $$;
