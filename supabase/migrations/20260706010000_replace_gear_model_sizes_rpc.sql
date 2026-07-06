-- Atomic replace for a gear model's size rows. The admin editor previously did
-- a client-side delete-then-insert (two calls) — a failed insert after the
-- delete would silently wipe the model's chart. This wraps both in one
-- transaction (a plpgsql function body), admin-gated, so a partial failure
-- rolls back and the existing chart survives.

begin;

create or replace function public.replace_gear_model_sizes(p_model_id uuid, p_sizes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  delete from public.gear_model_sizes where model_id = p_model_id;

  insert into public.gear_model_sizes
    (model_id, label, height_min, height_max, weight_min, weight_max, shoe_min, shoe_max, chest, waist, hip, sort_order)
  select
    p_model_id,
    s->>'label',
    nullif(s->>'height_min','')::numeric, nullif(s->>'height_max','')::numeric,
    nullif(s->>'weight_min','')::numeric, nullif(s->>'weight_max','')::numeric,
    nullif(s->>'shoe_min','')::numeric,   nullif(s->>'shoe_max','')::numeric,
    nullif(s->>'chest',''), nullif(s->>'waist',''), nullif(s->>'hip',''),
    coalesce(nullif(s->>'sort_order','')::int, (ord - 1)::int)
  from jsonb_array_elements(coalesce(p_sizes, '[]'::jsonb)) with ordinality as t(s, ord)
  where coalesce(s->>'label','') <> '';
end;
$$;

grant execute on function public.replace_gear_model_sizes(uuid, jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';
