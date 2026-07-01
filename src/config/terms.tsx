import { siteConfig } from './site'

// Terms of Use + privacy/retention content — a shop-specific SEAM file. A fork
// rewrites this to match its own legal posture; the page chrome, the versioned
// re-acceptance flow, and CURRENT_TERMS_VERSION (src/lib/terms-version.ts) live
// in core and don't change per shop. Bump CURRENT_TERMS_VERSION when the wording
// changes materially so every diver is re-prompted to accept.
//
// Intentionally plain: a small shop + a small user base deserves a summary a
// normal person can read in 90 seconds. A proper lawyer pass is still
// recommended before going live in anything resembling production.

const email = siteConfig.contact.email
const shopName = siteConfig.identity.shopName
const staffName = siteConfig.identity.shortName

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-brand-900">{title}</h2>
      <div className="text-brand-950 font-medium space-y-2">{children}</div>
    </section>
  )
}

export function TermsContent() {
  return (
    <>
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-[0.25em] text-red-600">Terms of Use & Privacy</p>
        <h1 className="text-2xl font-bold text-brand-900">The short version</h1>
        <p className="text-brand-900 font-medium">
          We ask for the information we need to plan your dives safely and to
          handle permits, insurance, and emergency contact. Nothing we collect
          is sold or shared beyond what's required to run the trip you signed
          up for.
        </p>
      </div>

      <Section title="What we collect">
        <p>At signup and when you register for an event:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Name, date of birth, nationality</li>
          <li>Passport / ARC number (for dive-site permits)</li>
          <li>Phone number and preferred contact method (LINE, WhatsApp, etc.)</li>
          <li>Certification agency, level, and logged-dive count</li>
          <li>A photo of your cert card, if you upload one</li>
          <li>Emergency contact name and phone</li>
          <li>Physical sizing (height, weight, shoe size) — for gear fitting</li>
          <li>Medical notes you choose to share</li>
        </ul>
        <p>
          <strong>Don't want to upload something through the app?</strong>{' '}
          Message us at{' '}
          <a className="text-brand-700 hover:underline" href={`mailto:${email}`}>
            {email}
          </a>{' '}
          and we'll handle it offline — bring your ID, cert card, or
          medical info to the shop on the day instead. The booking
          still works; the app just won't hold those fields.
        </p>
      </Section>

      <Section title="Why we collect it">
        <ul className="list-disc pl-5 space-y-1">
          <li>Plan the dive at a level matching your certification</li>
          <li>Generate permits and manifest paperwork for authorities</li>
          <li>Fit rental gear before you arrive</li>
          <li>Reach you or your emergency contact if something goes wrong</li>
          <li>Handle payments and refunds</li>
        </ul>
      </Section>

      <Section title="Who can see it">
        <ul className="list-disc pl-5 space-y-1">
          <li>You: all of your own data.</li>
          <li>{staffName} staff (admins): to plan events and handle check-in.</li>
          <li>Nobody else. We do not sell or share your data with marketers or other third parties.</li>
          <li>Authorities (if required by permit): name, ID number, nationality, and certification.</li>
        </ul>
      </Section>

      <Section title="Where your data lives">
        <p>
          <strong>We're a dive shop, not a tech company.</strong> We don't
          run our own servers. The app is built on top of widely-used
          third-party cloud services that we trust the same way most
          small businesses trust their email provider:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Database and login: Supabase</li>
          <li>Website hosting: Cloudflare</li>
          <li>Email: Gmail (Google)</li>
          <li>Push notifications: your browser's push service (Apple, Google, Mozilla)</li>
        </ul>
        <p>
          Your data sits on those providers' servers — most of it in
          Asia-Pacific data centres. By using the app you're OK with
          that arrangement. If you'd rather we kept your information
          entirely off these platforms, see the offline option in
          "What we collect" above.
        </p>
      </Section>

      <Section title="How long we keep it">
        <p>
          We automatically scrub sensitive fields <strong>12 months after your last booking</strong>:
          ID number, medical notes, emergency contact, and cert-card photo.
          Your core profile (name, cert agency + level, dive history) stays
          on file as business history unless you ask us to delete the whole
          account.
        </p>
      </Section>

      <Section title="Deletion and access">
        <p>
          Email <a className="text-brand-700 hover:underline" href={`mailto:${email}`}>{email}</a> to
          request a full export or deletion of your account. We'll honor it
          within a reasonable turnaround.
        </p>
      </Section>

      <Section title="Security and the limits of what we can promise">
        <p>
          We take reasonable steps to protect your data: encrypted
          connections, role-based access controls, regular review of
          who can see what, and routine deletion of stale information.
        </p>
        <p>
          <strong>But: we are not a tech company.</strong> Hacks,
          cyber-attacks, and breaches of cloud platforms happen — to
          companies far better resourced than us. If one of the
          services listed in "Where your data lives" suffers a breach,
          or someone successfully attacks the app itself, your data
          could be exposed. We can't promise that won't happen and we
          don't have the ability to undo it if it does. What we can
          promise is an honest, ongoing effort to keep your data safe
          and to tell you promptly if something has gone wrong.
        </p>
        <p>
          <strong>What this means for you:</strong> please don't put
          anything into this app that you would not be OK with
          potentially becoming public. If a piece of information feels
          too sensitive to risk, leave it out and tell us at the shop
          instead (see "What we collect" above). The choice of what to
          upload is yours, and so is the risk that comes with
          uploading it.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          Scuba diving is an inherently risky activity. By booking through
          {' '}{shopName} you confirm you meet the certification requirements
          for the dives you register for, you've disclosed relevant medical
          conditions, and you accept the usual risks of the activity. You
          remain responsible for honesty about your certifications and
          health.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change these terms materially we'll surface it on your next
          sign-in and ask you to re-agree. Day-to-day tweaks (fixing a typo,
          clarifying a sentence) don't need a re-prompt.
        </p>
      </Section>
    </>
  )
}
