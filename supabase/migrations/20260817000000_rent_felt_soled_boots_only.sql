-- The rental rack is felt-soled boots only. Rubber soles stay in the catalog
-- so a diver can record owning a pair on their profile, but they are no longer
-- something the shop rents, so no booking should name them as rented gear.
--
-- The earlier split (20260815000000) renamed every historical "Boots" rental to
-- the rubber-soled item on the assumption that the general-purpose pair was
-- what went out. It wasn't: what the shop has always handed over for the
-- algae-covered rock we shore-enter on is felt. Left alone, those bookings would
-- ask the packing board for a pair that isn't on the rack.
--
-- Same two exclusions as the split, for the same reasons:
--   * bookings.details.charges — a frozen receipt of what the diver was charged,
--     under the label they were shown at the time.
--   * admin_audit_log old/new snapshots — a record of what was written, not a
--     mirror of current state.
--
-- profiles.gear_owned is deliberately untouched. A diver who says they own
-- rubber-soled boots owns rubber-soled boots; that the shop doesn't rent them
-- is not a reason to rewrite what somebody told us about their own kit.

with mapped as (
  select b.id,
         e.ord,
         case when e.item = '"Boots (rubber sole)"'::jsonb
              then '"Boots (felt sole)"'::jsonb
              else e.item
         end as item
    from public.bookings b,
         lateral jsonb_array_elements(b.details -> 'gear' -> 'items')
                 with ordinality as e(item, ord)
   where jsonb_typeof(b.details -> 'gear' -> 'items') = 'array'
     and b.details -> 'gear' -> 'items' @> '["Boots (rubber sole)"]'::jsonb
),
-- A booking naming both soles would otherwise come out asking for two identical
-- pairs. The forms never allowed it, but the packing board is downstream of this.
deduped as (
  select id, item, min(ord) as ord
    from mapped
   group by id, item
)
update public.bookings b
   set details = jsonb_set(
         b.details,
         '{gear,items}',
         (select jsonb_agg(d.item order by d.ord) from deduped d where d.id = b.id)
       )
 where exists (select 1 from deduped d where d.id = b.id);
