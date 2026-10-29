# Event photo library

Self-hosted event photos (dive/trip/course images). An event's
`events.featured_image` holds the photo's path here, e.g.
`/imgs/media/<file>.webp`, and `src/lib/images.ts` (`resolveImageUrl`) uses it
as-is. So there is **no CDN dependency at runtime** and nothing extra is needed
in the CSP beyond `'self'`.

Drop a `.webp` here and put its path in the event's featured image field. An event whose
image is missing (or has no `featured_image`) falls back to a gradient card — it
does not break.

## Keep this folder small — GitHub gets hangry

These are committed binaries: every byte lives forever in git history and is
pulled on every clone and CI run. Stay well under GitHub's limits.

- **Per file:** GitHub *warns* over **50 MB** and *rejects* over **100 MB** (that
  needs Git LFS). Keep each image a pre-optimized `.webp`, ideally **under
  ~300 KB** (the current set averages ~120 KB).
- **This folder:** keep the total to a soft budget of **~50 MB**. Past that,
  clones/CI slow down and the repo drifts toward GitHub's recommended **1 GB**
  repo ceiling (they *strongly* recommend under 5 GB).
- Current usage: **~11 MB across 94 files** — plenty of headroom.

If you ever need many large/high-res images, don't commit them here — put them in
object storage (Supabase Storage, Cloudflare R2) and store the URL in
`featured_image` (http(s) URLs pass through `resolveImageUrl` unchanged), or use
Git LFS.
