# Wildlife taxa

The animals an almanac observation can name, and every language's word for
each. Migrations `20260909100000_wildlife_taxa.sql` (schema and RPCs),
`20260909110000_seed_wildlife_taxa.sql` (the starter catalog) and
`20260909120000_almanac_wildlife_backfill.sql` (the free text that was already
there).

## Problem this replaces

`almanac_records.wildlife` was a `text[]` fed by one comma-separated input.
Nothing joined the strings up, so the same animal arrived as `turtle`,
`Turtle`, `green turtle`, `sea turtle`, `ウミガメ` and `Chelonia mydas`, and
every tally the almanac takes counted those as six sightings of six things.
The more divers file, and the more languages they file in, the further the
counts drift from what was in the water — which is the one thing the data is
collected to measure.

Worse, it drifts *asymmetrically*. A shop running in Japanese accumulates
Japanese strings; the same reef surveyed by an English-speaking group produces
a disjoint set. Neither can be read beside the other, and no amount of later
cleaning recovers which "manta" meant which animal.

## Shape

Three tables, and the split between them is the whole idea:

- **`taxa`** — one row per organism, identified by `scientific_name`. This is
  the root key. It is the only name that is unique worldwide, stable across
  languages, and defined by somebody other than this project.
- **`taxon_names`** — the vernacular names, any number per taxon, each tagged
  with the language it belongs to. "Green sea turtle", "アオウミガメ" and
  "綠蠵龜" are three rows pointing at one taxon.
- **`almanac_sightings`** — what a record says was seen: a row per taxon per
  record, replacing the text array.

### Rank, not species-only

A diver who is sure it was a turtle but not which one is making a real
observation, and demanding a binomial would make them either guess or say
nothing. A taxon is filed at the finest rank the observer can honestly reach —
`phylum`, `class`, `subclass`, `superorder`, `order`, `family`, `genus`,
`species` — and the rank is stored, so a later analysis knows the resolution of
what it is counting.

Subclass and superorder are on the ladder because the two nodes divers reach
for most often sit exactly there: "a shark" is the superorder Selachimorpha and
"a ray" is Batoidea. Without them both sightings climb to a rung covering the
pair.

`parent_id` chains the ranks, so sightings filed at species roll up to their
genus and family. `taxon_rank_depth()` is the ladder as a value the database
can compare, and a trigger uses it to refuse a parent that does not sit
strictly above its child — plus, where a species hangs off a genus, a genus
whose name is not the first word of the species.

### Rules the schema holds

- `lower(scientific_name)` is unique. `Chelonia mydas` and `chelonia mydas` are
  one row.
- The name has to have the shape its rank demands: two words for a species, one
  capitalized word above it. A common name typed into that field is the exact
  failure the table exists to prevent, and `green sea turtle` fails both
  patterns.
- **`(lang, lower(name))` is unique across the whole of `taxon_names`.** Within
  one language a common name points at exactly one taxon. Two taxa both called
  "barracuda" in English is the old ambiguity moved one table over — the shop
  has to say which one, or qualify both.
- `almanac_sightings` holds exactly one of `taxon_id` and `raw_label`, and the
  same taxon cannot appear twice on one record.

### Synonyms collapse rather than compete

A scientific name that turns out to be another name for something already in
the catalog (`Manta alfredi`, now `Mobula alfredi`) is kept — divers and old
records still use it — with `accepted_id` pointing at the taxon that owns the
sightings, and `status = 'rejected'`, which is what "not a name this catalog
files under" means here. `submit_almanac_record` resolves through it, so the
two can never split a tally. Synonyms do not chain: a trigger requires the
target to be accepted itself, so resolution is one hop and cannot loop.

## Divers propose; staff rule

A diver who cannot find their animal supplies a **scientific name** —
`propose_taxon` — and files the sighting against the proposal straight away.
The proposal is `pending`: nobody else's picker offers it and no crowd tally
counts it until staff rule.

Asking for Latin is deliberate. A scientific name is something a person can
check; a fifth spelling of "turtle" is not. A diver who cannot supply one is
not stuck — they file at the level they are sure of, and "some kind of goby" is
Gobiidae, which is already in the catalog.

`propose_taxon` is **get-or-propose**, not always-insert: a name already known
comes back as itself (resolved through any synonym), and a name somebody else
has already proposed comes back as that proposal. Duplicate proposals are the
same disease as duplicate free text, arriving one table later.

**A record cannot be approved while it names an unreviewed taxon.**
`moderate_almanac_record` refuses with `almanac_record_has_unreviewed_taxa`,
and `almanac_pending_records` returns `unreviewed_taxa` so the queue says which
animal is holding a record up before the button is pressed. Rejection is never
blocked — throwing a record out does not need its wildlife adjudicated first.

## Writes are RPC-only

`authenticated` is granted **SELECT** and nothing else on all three tables.

| Function | Who | What |
| --- | --- | --- |
| `propose_taxon` | any signed-in diver | Get-or-propose a taxon by scientific name, with an optional common name in one language. |
| `save_taxon` | staff / admin | Create or edit a catalog entry. |
| `moderate_taxon` | staff / admin | Approve or reject a proposal. With `p_accepted_id` it **merges**: every sighting moves to that taxon, colliding ones are dropped, and the rejected name becomes a synonym of it. |
| `delete_taxon` | staff / admin | Remove an entry nothing stands on. Refuses one with sightings or children — those are merged. |
| `set_taxon_name` / `delete_taxon_name` | staff / admin | Curate the vernacular names; one primary per language. |
| `almanac_unmatched_wildlife` | staff / admin | The loose pre-catalog labels, grouped by the string, with how much is standing on each. |
| `map_unmatched_wildlife` | staff / admin | Point every sighting carrying one label at a taxon. Returns how many moved. |

RLS on `taxa` shows the approved catalog to everyone, a pending proposal to its
author and to staff, and nothing pending to anyone else. `taxon_names` follows
its taxon; `almanac_sightings` follows its record.

## Reading it back

The read RPCs return **ids**, not names: `wildlife_taxa uuid[]` and
`wildlife_unmatched text[]` in place of the old `wildlife text[]`. The page
loads the catalog once (`fetchTaxa`) and every reading surface resolves ids
against that one map, so a payload never carries the same strings on every row
in a language the database chose.

Two arrays rather than one blended list, because they are different kinds of
thing: an id the catalog vouches for, and a string nobody has vouched for. A
surface that could not tell them apart would print an unverified label beside a
curated one as though they carried the same weight.

`src/lib/taxa.ts` holds the arithmetic, network-free:

- `displayName` — the deployment's language, then English, then the scientific
  name. English is the one cross-language fallback because it is the catalog's
  schema language. It deliberately does **not** reach for a third language:
  showing a Japanese reader a Chinese label presents one language's word as
  another's.
- `searchTaxa` — matches every name in every language plus the scientific name,
  ranked by where the match landed and whether it was in the reader's own
  language. Every language on purpose: a shop running in English still has
  divers who know the fish as ハタタテダイ.
- `scientificNameProblem` — the DB's shape check, mirrored, so the propose form
  says "that is a common name" instead of a failed round trip.
- `ownRecordsFrom`, `attachNames` — the two-read joins. PostgREST can embed
  `taxon_names` inside `taxa`, but the typed inference for that needs
  foreign-key metadata this project's hand-written `Database` type does not
  carry.

`src/lib/wildlife.ts` is the network layer for all of the above.

## The starter catalog

`20260909110000` seeds ~100 taxa — the Indo-Pacific reefs this app was written
for — with English, Japanese and Traditional Chinese names. It is reference
data, not shop content: a scientific name is the same in Kenting, Okinawa and
Palau, so it ships with the app the way certification levels do.

The list is deliberately shallow in places. Where a diver can reasonably tell
the species (a whale shark, a moorish idol) there is a species; where they
usually cannot (a goby, a damselfish, a soft coral) the entry is the family or
the order, because a catalog offering only species pushes an honest "some kind
of goby" into either a guess or a blank.

**Names are omitted rather than guessed.** A taxon with no name in a language
renders as its scientific name, which is correct and readable; a plausible but
wrong common name is neither, and the unique `(lang, name)` index would lock
the mistake in as the one thing that word can mean.

## What happened to the old free text

`20260909120000` reads every string the column ever held, matches it against
the seeded catalog — exactly, on the scientific name or on a common name in
**any** language, with one concession to English plurals — and writes it back
as a sighting. What matches becomes a real one; what does not becomes a
`raw_label` sighting, which is the same string held somewhere staff can map it
from in one action. A label matching two different taxa is left unmatched on
purpose: that ambiguity is what the schema exists to surface.

The column is then dropped. Leaving it would leave two answers to "what did
this record say was in the water", one of which nothing updates any more.

## Surfaces

- `/almanac` — `WildlifePicker` replaces the text box: search, chips, and an
  inline propose form. Pre-catalog labels on an entry being corrected are shown
  read-only, because mapping them is staff's call.
- `/admin/wildlife` — the catalog, the proposal queue, and the unmatched-label
  queue, in the order the work arrives.
