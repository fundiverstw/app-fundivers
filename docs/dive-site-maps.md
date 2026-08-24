# Dive-site maps

Diver-contributed seafloor maps, in 3D. **Admin-only for now** — the tile on
the diver home page is greyed out for everyone else, and will be opened up once
the model has been tested against a real site.

Status: the model, the renderer and the contribution editor exist and are
covered by tests. **Nothing is persisted yet** — there is no table and no
migration, and the workbench holds contributions in page state only.

## Why this exists

The research case is in `ignore/proposals/namr-collaboration-proposal.md`. In short:
NODASS publishes a 200 m seafloor grid, and a depth grid stores one value per
horizontal position, so it structurally cannot hold the overhangs, arches and
swim-throughs divers navigate by. Sites like 龍洞 4號 are still dived from
hand-drawn sketches with no datum or coordinates. This feature tests whether
divers will fill that gap themselves.

## The model — `src/lib/dive-site-map.ts`

| Decision | Why |
| --- | --- |
| Positions are **site-local meters**, not lat/lng | A hand-drawn map has a scale bar but no coordinates, and a diver knows "twelve meters past the Dragon Head", not their WGS84 position. `frame.origin` is optional; a map without one is still usable. |
| Depth carries its **datum** and its **time** | A dive computer reads depth below whatever surface it is under, so a contribution is `instantaneous` and moves with the tide. Only a reading with `observed_at` can later be reduced to TWCD2021. `canReduceToDatum()` says which; `unreducibleSoundings()` lists what can never be. |
| `ObservationSource` includes **`placeholder`** | Scaffolding is not observation. Placeholder records are stripped by `observedOnly()` before anything is measured, counted or rendered as seabed. |
| Features can be **volumetric** | `VOLUMETRIC_FEATURES` names arch / swim_through / overhang / cave — the kinds a depth grid cannot express at any resolution. This is the research claim made executable. |
| Records carry **`contribution_id`** | Attribution works like a commit: history, per-diver counts and reverting all follow. |

### The editing lattice

Divers correct depths on a **1 m lattice**, and the lattice is **implicit** —
no record exists for a position until somebody puts a reading there.

Storing it would not work: a 500 m site at 1 m spacing is 250,000 positions,
and a kilometer-wide one is over a million. As rows they are a million writes of
nothing; as meshes, a million draw calls; as input to the triangulation, a
multi-second stall on a phone.

- `snapToLattice(at)` rounds a tap to the nearest meter.
- `latticeId(at)` derives a stable id from the coordinate, so two divers
  correcting the same position produce the same id and can be reconciled
  rather than duplicated.
- The 3D view draws only a **subset** of lattice positions (capped near 4,000),
  thinned to whatever step keeps the count readable. The hint text states the
  true 1 m spacing, because someone who assumes the visible dots are the
  resolution would be wrong by an order of magnitude.

## The surface — `src/lib/dive-site-surface.ts`

Scattered soundings become a seafloor by Delaunay triangulation
(`delaunator`), with one rule that keeps it honest: **a triangle's credibility
falls with its size.**

- Solid up to `solidEdge_m` (15 m), fading linearly to nothing at
  `cutoffEdge_m` (60 m). Past the cutoff a triangle is **dropped**, not drawn
  at zero opacity, so no material tweak can reveal it.
- Vertices are **not shared** between triangles. Sharing would average a
  well-sampled triangle's confidence with its guesswork neighbor's and quietly
  make the gaps look covered.
- `coverageFraction()` is reported in the caption, so the render never has to be
  taken on trust.
- The depth ramp is monotonic in **luminance** as well as hue, so it survives
  greyscale and color-blindness.

A grid spaced wider than `cutoffEdge_m` renders as nothing at all — that bug
happened, and `site-seeds.test.ts` now pins the spacing below the cutoff.

## The 3D view — `src/components/divesites/DiveSiteScene.tsx`

All arithmetic lives in the surface lib, which is unit-tested; this file is the
part that cannot be tested without a GPU, so it stays thin and fails to a
readable message when WebGL is unavailable.

- **Under three readings** it renders a flat base plane (two triangles,
  whatever the site's size) rather than an error — a diver needs a seabed to tap
  before anyone has measured anything.
- **Vertical exaggeration** defaults to 3× and is **stated in the caption**. At
  true scale, tens of meters of relief across hundreds of meters of width
  flattens into nothing.
- **Picking is screen-space**, not ray-vs-sphere: markers a meter across in a
  500 m scene are a few pixels, and a tap means "nearest marker within ~24 px".
  A pointer that moves more than 6 px between down and up is a camera drag, not
  a tap.
- **Volumetric features are wireframe markers.** Position is real; shape is
  schematic, and a solid mesh would imply a survey nobody has done.
- **Compass** is an SVG overlay, not scene geometry, so it stays crisp and its
  "N" is translatable. Rotated via the SVG `transform` attribute — CSS
  `transform-origin` on a `<g>` resolves against that group's bounding box and
  swings the rose off-axis.
- **WASD / arrow keys** move camera and orbit target together. Speed scales with
  site size; the handler ignores events from inputs, or typing a depth would fly
  the camera.

## Contributing — `src/lib/site-map-draft.ts`

A draft is deliberately **separate** from the map it will be added to: a
contribution is a proposal, reviewable before it lands and discardable without
disturbing what is there.

- `applyPick()` holds the rule that **only existing points are editable**. A tap
  that hits nothing is ignored rather than dropping a reading into open water.
  Free placement sounds more capable and is worse: points land wherever a finger
  happened to be in a perspective view, they supersede nothing, and the site
  accumulates a lattice of corrections plus a scatter of near-duplicates.
- Corrections carry `supersedes`, so the flat original does not survive
  underneath its own fix, and correcting the same point twice replaces the
  earlier value rather than stacking.
- Every placed sounding is stamped `instantaneous` with the time **at
  placement** — asking at the end would produce readings that can never be
  tide-corrected. `validate()` refuses to submit one without a time, and refuses
  depths outside 1–100 m as typos.
- `SiteContribution.contributor` is **display identity only**. The server must
  derive the real contributor from the session; trusting a client-supplied id
  would let anyone attribute a reading to another diver — the same class of hole
  the booking guard trigger closed.

### Privacy: not quite git

Attribution is modeled on a commit, with one deliberate difference. Git
publishes an author's email because it is a tool for developers who accepted
that trade. A dive-site map is read by strangers, so **only the display name
travels with a published contribution**; the email stays in `profiles`,
reachable by an admin who needs to ask about an odd reading, and is never
rendered.

## Access

Admin-only, gated in `DashboardPage`: the `QuickLinks` tile links through for
`profile.role === 'admin'` and renders greyed out (not hidden) for everyone
else. A tile that appears from nowhere later is harder to notice than one that
lights up.

Both home pages render the tiles — the diver `/dashboard` and the admin
`/admin/home`. An admin working inside the admin chrome never passes through the
diver home, so gating the only entry point behind a page they don't visit made
the feature admin-only in name and unreachable in practice.

The workbench itself is `/dev/site-map`, dev-only via `import.meta.env.DEV` and
outside the auth guards so the renderer can be looked at without a session. It
is tree-shaken out of production builds.

## What is not built

- **No persistence.** No table, no migration, no RLS. `onSubmit` hands back a
  `SiteContribution` and the workbench keeps it in page state.
- **No contour or feature drawing.** The draft model supports both
  (`addVertex`, `commitPath`, every `FeatureKind`), but the 2D editor that drove
  them was removed with the flat view, and tracing an outline on an orbiting
  surface is a different interaction, not a port.
- **No georeferencing.** Every site has `frame.origin` absent until somebody
  surveys one.
- **Nothing from Lin Ko-Chuan's map.** His 2015 drawing of 龍洞 4號 is
  copyrighted and watermarked, and digitizing it needs his permission. Longdong
  4 here starts genuinely empty.

## Dependencies

`three` (~150 KB gzipped) and `delaunator`. **Not yet lazy-loaded** — three
currently lands in the main bundle, which should become a `React.lazy` boundary
before this ships to divers on mobile.
