import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Data Deletion Instructions | Akmez',
  description:
    'How to request deletion of the messages, comments and contact details held by A AKMEZ GROUP LTD.',
}

const CONTACT_EMAIL = 'akmez@hotsalesltd.onmicrosoft.com'

const STEPS = [
  {
    title: 'Send us a deletion request',
    body: 'Email us at the address below from the email account you wish to hear back on, or reply to any of our WhatsApp Business numbers with the words "DELETE MY DATA".',
  },
  {
    title: 'Tell us how to find you',
    body: 'Include the WhatsApp number you contacted us from, or the name shown on the Facebook or Messenger conversation. We need this to locate your records — we cannot act on a request we cannot match to a conversation.',
  },
  {
    title: 'We confirm and delete',
    body: 'We verify that the request comes from the owner of the conversation, delete the records, and confirm in writing. We complete this within 30 days, and usually much sooner.',
  },
]

const DELETED = [
  'The content of every message you sent to our WhatsApp Business numbers, and every reply we sent you.',
  'Your WhatsApp number and stored profile name.',
  'Message metadata, including timestamps and the advertising identifier attached to a conversation that began from an advertisement.',
]

const NOT_DELETED = [
  'Records we are required to keep by law — for example an invoice relating to a completed purchase, which accounting and tax rules oblige us to retain for a statutory period.',
  'Copies held by Meta on Facebook, Messenger or WhatsApp. Those are controlled by Meta, not by us. Deleting your data with us does not remove the conversation from your own WhatsApp or Messenger app, and does not affect your Meta account.',
  'Anonymous, aggregated counts that can no longer be linked back to you.',
]

export default function DataDeletionPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16 md:py-24">
        <header className="flex flex-col gap-4 border-b border-border pb-10">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            A Akmez Group Ltd
          </p>
          <h1 className="text-pretty text-4xl font-semibold leading-tight md:text-5xl">
            Data Deletion Instructions
          </h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            You can ask us to delete the messages and contact details we hold
            about you at any time, free of charge, without giving a reason.
          </p>
        </header>

        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-semibold">How to request deletion</h2>
          <ol className="flex flex-col gap-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-5">
                <span
                  aria-hidden="true"
                  className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary font-mono text-sm text-primary"
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-medium">{step.title}</h3>
                  <p className="text-pretty leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col gap-4 rounded-[--radius] border border-border bg-card p-8">
          <h2 className="text-xl font-semibold">Where to send it</h2>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Data%20deletion%20request`}
            className="w-fit break-all text-lg text-primary underline-offset-4 hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Please use the subject line &quot;Data deletion request&quot; so
            that we can prioritise it.
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">What gets deleted</h2>
          <ul className="flex flex-col gap-3 border-l border-border pl-5">
            {DELETED.map((item) => (
              <li
                key={item.slice(0, 40)}
                className="text-pretty leading-relaxed text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-2xl font-semibold">What we cannot delete</h2>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            So that there is no misunderstanding, the following falls outside
            what we are able to remove:
          </p>
          <ul className="flex flex-col gap-3 border-l border-border pl-5">
            {NOT_DELETED.map((item) => (
              <li
                key={item.slice(0, 40)}
                className="text-pretty leading-relaxed text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4 border-t border-border pt-8">
          <h2 className="text-xl font-semibold">Related</h2>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Our{' '}
            <Link
              href="/privacy"
              className="text-primary underline-offset-4 hover:underline"
            >
              privacy policy
            </Link>{' '}
            explains what we collect, why we collect it, and how long we keep
            it.
          </p>
        </section>

        <footer className="border-t border-border pt-8">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} A AKMEZ GROUP LTD. All rights
            reserved.
          </p>
        </footer>
      </div>
    </main>
  )
}
