import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

// Terms of Use + retention policy shown to divers at signup. Intentionally
// plain: a small shop + a small user base deserves a summary a normal person
// can read in 90 seconds. A proper lawyer pass is still recommended before
// going live in anything resembling production.

export function TermsPage() {
  return (
    <div className="min-h-screen bg-sky-50 text-blue-900">
      <header className="bg-blue-950 border-b border-red-500 px-4 py-3">
        <Link to="/" aria-label="FunDivers Taiwan home"><Logo size="sm" /></Link>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-6 text-sm leading-relaxed">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.25em] text-red-600">Terms of Use & Privacy</p>
          <h1 className="text-2xl font-bold text-blue-900">The short version</h1>
          <p className="text-blue-900 font-medium">
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
            <li>FunDivers staff (admins): to plan events and handle check-in.</li>
            <li>Nobody else. We do not sell or share your data with marketers or other third parties.</li>
            <li>Authorities (if required by permit): name, ID number, nationality, and certification.</li>
          </ul>
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
            Email <a className="text-blue-700 hover:underline" href="mailto:fundiverstw@gmail.com">fundiverstw@gmail.com</a> to
            request a full export or deletion of your account. We'll honor it
            within a reasonable turnaround.
          </p>
        </Section>

        <Section title="Liability">
          <p>
            Scuba diving is an inherently risky activity. By booking through
            FunDivers TW you confirm you meet the certification requirements
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

        <div className="text-center pt-6">
          <Link to="/" className="text-sm text-blue-700 hover:underline">‹ back</Link>
        </div>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold text-blue-900">{title}</h2>
      <div className="text-blue-950 font-medium space-y-2">{children}</div>
    </section>
  )
}
