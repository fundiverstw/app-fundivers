-- Boots split into two catalog items: "Boots (rubber sole)" and
-- "Boots (felt sole)". They are not interchangeable in the water — felt grips
-- algae-covered rock on a shore entry, rubber is for boats, sand and walking —
-- so the shop stocks and packs them as separate lines.
--
-- Gear items are stored as their config label, so existing rows still say
-- "Boots" and would no longer match anything in the catalog: the profile
-- checklist would silently drop the diver's choice and the logistics board
-- would leave the pair off the packing totals. Rename them to the rubber-soled
-- item, which is the general-purpose pair the shop has always rented.
--
-- Two things are deliberately NOT rewritten:
--   * bookings.details.charges — a frozen receipt of what the diver was
--     charged, under the label they were shown at the time.
--   * admin_audit_log old/new snapshots — a record of what was written, not a
--     mirror of current state.

update public.profiles
   set gear_owned = array_replace(gear_owned, 'Boots', 'Boots (rubber sole)')
 where 'Boots' = any(gear_owned);

update public.bookings b
   set details = jsonb_set(
         b.details,
         '{gear,items}',
         (
           select jsonb_agg(
                    case when item = '"Boots"'::jsonb
                         then '"Boots (rubber sole)"'::jsonb
                         else item
                    end
                    order by ord
                  )
             from jsonb_array_elements(b.details -> 'gear' -> 'items')
                  with ordinality as e(item, ord)
         )
       )
 where jsonb_typeof(b.details -> 'gear' -> 'items') = 'array'
   and b.details -> 'gear' -> 'items' @> '["Boots"]'::jsonb;
