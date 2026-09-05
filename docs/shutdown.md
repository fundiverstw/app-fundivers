# Closing down — take your data with you and switch everything off

This is [deployment](deployment.md) in reverse: how to shut your shop's app
down without losing anything you are obliged to keep, and without leaving a
diver's money — or a diver's personal data — stranded on a service you no longer
watch.

**You do not need to be a programmer.** As with setup, most of it is clicking
buttons on websites you already have accounts for. Budget an hour, plus however
long you need to settle up with divers.

> **Everything below is permanent.** Deleting a Supabase project takes two
> clicks and there is no undo, no trash, and no support ticket that brings it
> back. Work top to bottom: the steps are ordered so that nothing you still need
> is gone before you have a copy of it.

The app has a page that walks the same path and checks your figures as it goes:
sign in as an admin and open **Manage → Close down the shop** (`/admin/shutdown`).
Use it alongside this document — it can see your data, and this can't.

---

## Part 1 · Settle what is outstanding

Deleting the database does not settle a debt in either direction; it only
destroys the record of it.

1. **Money divers owe you.** Collect it, write it off, or accept that you won't
   see it. Admin → Audits shows every registration's balance.
2. **Money you owe divers.** Unspent account credit is the shop holding
   someone's money. Refund it (Admin → Refunds) before the record disappears.
   This is the one item on this list that can turn into a real dispute months
   later, when you no longer have a database to check.
3. **Events still on the calendar.** Cancel them in the app so divers get the
   cancellation notice while notifications still work.
4. **Anything you owe a partner shop** — package or trip kickbacks tracked in
   Admin → Packages / Scheduled Trips.

The shutdown page counts all four for you and links to the page that fixes each.

## Part 2 · Take your records with you

Do this **before** you touch any infrastructure. Two of these come out of the
app; the third has to be pulled from Supabase by hand.

1. **The whole database, as spreadsheets.** Admin → **Back up database** gives
   you a ZIP with one CSV per table plus a manifest. Any spreadsheet opens it —
   you don't need this app, or a database, to read it later.
2. **Bookkeeping and waivers.** Admin → **Revenue & documents**: the
   fiscal-year payment ZIP, and per-diver signed-waiver PDFs.
3. **Uploaded files.** Certification cards, signed waiver PDFs and dive-site
   maps live in Supabase **Storage**, not in the database, so the CSV backup
   does not contain them. In the Supabase dashboard open **Storage**, and for
   each bucket use the file list to download what you want to keep. If a bucket
   is large, `supabase storage cp -r ss://<bucket> ./<folder> --experimental`
   from a terminal pulls it all in one go. `make backup-prod` additionally
   takes a full SQL dump (roles + schema + data), which the CSV backup is not.

Keep the result somewhere you would be willing to keep a filing cabinet of the
same material — it contains names, dates of birth, contact details, emergency
contacts, payment records and waiver signatures.

## Part 3 · Tell your divers

They lose the app the moment you switch it off, and with it their booking
history and dive logs. Give them warning and a chance to save what they want.

- The shutdown page sends **one push notification to every subscribed device**,
  prefilled and editable. It is the last thing the app can say.
- Push only reaches people who turned notifications on. Also announce it the
  way you announce anything else — email list, social, a sign in the shop.
- If divers want their own dive logs, tell them to export them from
  **Records → Dive logs** before the date you switch off.

## Part 4 · Switch off the infrastructure

In this order. The site goes dark at step 2, and the data goes at step 5.

| # | Where | What to do | What breaks |
| --- | --- | --- | --- |
| 1 | Cloudflare → **Websites** | Remove the custom domain / DNS records, if you added a domain | The friendly address stops resolving |
| 2 | Cloudflare → **Workers & Pages** | Delete the app Worker (the one named for your shop) | Divers can no longer reach the app |
| 3 | Cloudflare → **Workers & Pages** | Delete the push Worker | Nightly reminders and admin broadcasts stop |
| 4 | Cloudflare → **Turnstile** | Delete the widget | Nothing — the signup form it protected is already gone |
| 5 | Supabase → **Project Settings → General → Delete project** | Delete the project | **Everything**: bookings, logins, uploaded files, edge functions, secrets |
| 6 | Google Account → **Security → App passwords** | Revoke the app password the shop used to send booking email | The app can no longer send mail as you |
| 7 | GitHub | Delete or archive your repository, and delete its Actions secrets (Settings → Secrets and variables → Actions) | The deploy pipeline stops; your copy of the code goes if you delete rather than archive |

A few things worth knowing before step 5:

- **Deleting the Supabase project also deletes the diver logins.** Accounts live
  in that project's auth, not somewhere central.
- **Edge function secrets go with the project** (`GMAIL_USER`,
  `GMAIL_APP_PASSWORD`, `TURNSTILE_SECRET`). There is nothing separate to clean
  up.
- **Push keys.** The VAPID key pair is only stored in the Cloudflare Worker's
  secrets and in your `.env` files, so it is gone with step 3 — but delete the
  local `.env` copies too if you are decommissioning the computer.

## Part 5 · Close the accounts

Only after everything above: you need to be signed in to do any of it.

- **Cloudflare** — Manage Account → Account Settings → Delete account (remove
  or move any other domains first; deleting an account with active domains will
  take them offline).
- **Supabase** — Account Settings → Delete account, once no organization you own
  still has projects.
- **GitHub** — Settings → Danger Zone → Delete account, if you opened it only
  for this.
- **Gmail** — keep it. The address is on paperwork your divers hold, and mail
  sent to a deleted Gmail address bounces without explanation.

## Part 6 · What to keep, and for how long

Two obligations pull in opposite directions, and both are yours to weigh:

- **Keep** what your jurisdiction requires you to keep. Payment and tax records
  are commonly five to seven years; signed liability waivers are often kept for
  as long as a claim could still be brought, which can be longer. Your
  accountant or lawyer knows the numbers where you are — ask before you delete
  your only copy.
- **Delete** what you no longer have a reason to hold. A backup ZIP of every
  diver's date of birth and emergency contact is a data-protection liability
  sitting on a laptop. Keep the parts you must; get rid of the rest, and store
  what remains encrypted.

FunDive itself has no opinion here, and no way to enforce one — but the backup
it gives you is a single file, which makes it easy to keep for years by accident.

## If you are pausing, not closing

Shutting down is not the only option, and the cheap ones are worth knowing:

- **Free tiers cost nothing to leave running.** A quiet shop's app on Cloudflare
  and Supabase free tiers costs $0/month. Supabase pauses inactive free projects
  by itself after a week of no requests, and you can restore one from the
  dashboard.
- **Take the app offline but keep the data** — delete the Cloudflare Workers
  (steps 2–3) and leave Supabase alone. Nothing is lost, and redeploying later
  is one `make deploy`.
- **Keep a copy without keeping a service** — take the CSV backup and the
  storage files (Part 2), then delete everything. You can read your history
  forever; you just can't run the app on it.

## If something goes wrong

- **Deleted the Supabase project by mistake?** Contact Supabase support
  immediately — recovery is not guaranteed and depends on your plan and how long
  ago it happened. This is why Part 2 comes first.
- **Divers still emailing about bookings?** The CSV backup answers most
  questions: `bookings.csv`, `payments.csv` and `profiles.csv` between them tell
  you who booked what and what they paid.
