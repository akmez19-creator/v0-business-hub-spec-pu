import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | Akmez',
  description:
    'How Akmez collects, uses, stores and deletes data obtained through the Meta Graph API, WhatsApp Business Cloud API and Facebook Pages.',
}

const EFFECTIVE_DATE = '16 August 2026'
const CONTACT_EMAIL = 'akmez@hotsalesltd.onmicrosoft.com'

const SECTIONS = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: [
      'This privacy policy applies to the internal business dashboard operated by A AKMEZ GROUP LTD ("we", "us", "our"), reachable at akmez.tech.',
      'The dashboard is a private tool used by our own staff to read and reply to customer enquiries that arrive through the Facebook Pages, Messenger accounts and WhatsApp Business numbers we operate. It is not a public product, it is not offered to third parties, and no account can be created on it by members of the public.',
      'The Pages and WhatsApp Business numbers covered by this policy include Made By Moris, Destockage By Moris, Hot Sales By Moris and Buildeco.',
    ],
  },
  {
    id: 'what-we-collect',
    title: 'What information we process',
    body: [
      'When you send us a message or comment on one of our Pages, we process the information Meta passes to us so that a member of our team can read it and reply:',
    ],
    list: [
      'Your message content — the text, images, audio, video or documents you send us.',
      'Your WhatsApp number and the display name shown on your WhatsApp profile, when you message one of our WhatsApp Business numbers.',
      'Your public comment content on posts published by our Facebook Pages. Meta does not disclose commenter names to our app, so comments are handled without an associated identity.',
      'Message metadata — timestamps, message identifiers, which of our numbers or Pages you contacted, and whether a message was inbound or outbound.',
      'Advertising context — where a conversation began as a reply to one of our advertisements, the identifier of that advertisement.',
    ],
    after: [
      'We do not collect payment card details, government identifiers, precise location, health data or any special category data through this dashboard. Please do not send such information to us over Messenger, comments or WhatsApp.',
    ],
  },
  {
    id: 'how-we-use',
    title: 'How we use it',
    body: ['We use the information above only to:'],
    list: [
      'Read, organise and reply to your enquiry.',
      'Fulfil an order you place with us, including arranging delivery.',
      'Keep a record of our correspondence with you so that a later enquiry can be handled with the right context.',
      'Moderate our own Page posts by hiding or removing comments that breach our community standards.',
    ],
    after: [
      'We do not sell your information. We do not share it with advertisers or data brokers. We do not use your messages to build advertising profiles, and we do not use them to train machine learning models.',
    ],
  },
  {
    id: 'legal-basis',
    title: 'Why we are allowed to process it',
    body: [
      'Where the General Data Protection Regulation applies, we rely on the performance of a contract when processing is necessary to answer your enquiry or fulfil your order, and on our legitimate interest in operating a responsive customer service function for the remainder. Where we rely on legitimate interest you may object at any time using the contact details below.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who else can see it',
    body: [
      'Your messages are visible to authorised staff of our businesses who are signed in to the dashboard. Access requires an individual account and is protected by authentication.',
      'We rely on a small number of processors to operate the service:',
    ],
    list: [
      'Meta Platforms — delivers your messages and comments to us through the Graph API and the WhatsApp Business Cloud API, and independently applies its own privacy policy to your use of Facebook, Messenger and WhatsApp.',
      'Supabase — hosts the database in which messages are stored.',
      'Vercel — hosts the dashboard application.',
    ],
    after: [
      'We may also disclose information where we are required to do so by law, or where necessary to establish, exercise or defend legal claims.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: [
      'We retain correspondence for as long as needed to serve you and to keep a record of any resulting order, and no longer than 24 months after our last contact with you, unless a longer period is required for accounting, tax or legal purposes.',
      'Media you send us — images, audio, video and documents — is not stored on our servers. It remains with Meta and is retrieved on demand while a member of our team is viewing the conversation. Meta deletes such media approximately 30 days after it is sent, after which it is no longer retrievable.',
    ],
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: ['Subject to applicable law, you may ask us to:'],
    list: [
      'Confirm whether we hold information about you, and provide a copy of it.',
      'Correct information that is inaccurate or incomplete.',
      'Delete your information — see the data deletion page for how to request this.',
      'Restrict or object to our processing of your information.',
      'Withdraw consent, where our processing is based on consent.',
    ],
    after: [
      'We respond to requests within 30 days. If you are in the European Union and you believe we have not handled your information properly, you may lodge a complaint with your national supervisory authority.',
    ],
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: [
      'Data is transmitted over encrypted connections and stored in a database that is not publicly reachable. Access to the dashboard requires authentication, and inbound message traffic from Meta is verified by cryptographic signature before it is accepted. No system can be guaranteed perfectly secure, but we take reasonable technical and organisational measures appropriate to the sensitivity of the information.',
    ],
  },
  {
    id: 'children',
    title: "Children's information",
    body: [
      'Our businesses are not directed at children, and we do not knowingly process the information of anyone under 16. If you believe a child has sent us information, contact us and we will delete it.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: [
      'If we change this policy we will update the effective date shown at the top of this page. Material changes will be described here rather than applied silently.',
    ],
  },
]

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-16 md:py-24">
        <header className="flex flex-col gap-4 border-b border-border pb-10">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">
            A Akmez Group Ltd
          </p>
          <h1 className="text-pretty text-4xl font-semibold leading-tight md:text-5xl">
            Privacy Policy
          </h1>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            How we handle the messages, comments and contact details you send to
            our Facebook Pages and WhatsApp Business numbers.
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            Effective {EFFECTIVE_DATE}
          </p>
        </header>

        <nav aria-label="Contents" className="flex flex-col gap-3">
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Contents
          </h2>
          <ol className="flex flex-col gap-2">
            {SECTIONS.map((section, index) => (
              <li key={section.id} className="flex gap-3 text-sm">
                <span className="font-mono text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <a
                  href={`#${section.id}`}
                  className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex flex-col gap-12">
          {SECTIONS.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="flex scroll-mt-8 flex-col gap-4"
            >
              <h2 className="flex items-baseline gap-3 text-2xl font-semibold">
                <span className="font-mono text-sm text-primary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {section.title}
              </h2>

              {section.body.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="text-pretty leading-relaxed text-muted-foreground"
                >
                  {paragraph}
                </p>
              ))}

              {section.list ? (
                <ul className="flex flex-col gap-3 border-l border-border pl-5">
                  {section.list.map((item) => (
                    <li
                      key={item.slice(0, 40)}
                      className="text-pretty leading-relaxed text-muted-foreground"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : null}

              {section.after?.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  className="text-pretty leading-relaxed text-muted-foreground"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <section
          id="contact"
          className="flex scroll-mt-8 flex-col gap-4 rounded-[--radius] border border-border bg-card p-8"
        >
          <h2 className="text-2xl font-semibold">Contact us</h2>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            For any question about this policy, or to exercise any of the rights
            described above, contact the data controller:
          </p>
          <div className="flex flex-col gap-1">
            <p className="font-medium">A AKMEZ GROUP LTD</p>
            <p className="text-muted-foreground">Mauritius</p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="w-fit text-primary underline-offset-4 hover:underline"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            To request deletion of your data, see our{' '}
            <Link
              href="/data-deletion"
              className="text-primary underline-offset-4 hover:underline"
            >
              data deletion instructions
            </Link>
            .
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
