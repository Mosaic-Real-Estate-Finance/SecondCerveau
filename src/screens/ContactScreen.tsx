import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContactsState } from "@/App";
import { Screen, TextButton, TopBar } from "@/components/screen";
import { ContactForm } from "@/components/contact-form";
import { MorphPanel } from "@/components/morph-panel";
import { SearchField } from "@/components/search-field";
import { recentContacts, type Contact } from "@/lib/api";
import { type NoteContact } from "@/lib/notes";
import { cn } from "@/lib/utils";

// Accent and case insensitive, so "Leonard" finds "Léonard".
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// Digits in national form, so "06 12", "+33 6 12" and "0033 6 12" all match.
// Same rule for Swiss numbers (+41).
function nationalDigits(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (/^(33|41)\d{9}$/.test(digits)) digits = `0${digits.slice(2)}`;
  return digits;
}

type Match = { contact: Contact; phone?: string };

// Name (the page title), company and phone numbers. Every word typed must be
// found in the name or the company; a query with three digits or more also
// looks through the numbers.
function match(contact: Contact, query: string): Match | null {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const text = fold(`${contact.name} ${contact.company}`);
  if (words.length && words.every((word) => text.includes(word))) return { contact };
  const digits = query.replace(/\D/g, "");
  if (digits.length >= 3) {
    const wanted = nationalDigits(query);
    const phone = contact.phones.find((number) => {
      const national = nationalDigits(number);
      return national.includes(wanted) || number.replace(/\D/g, "").includes(digits);
    });
    if (phone) return { contact, phone };
  }
  return null;
}

export function ContactScreen({
  active,
  contacts,
  onReload,
  onCreated,
  onBack,
  onPick,
}: {
  active: boolean;
  contacts: ContactsState;
  onReload: () => void;
  onCreated: (contact: Contact) => void;
  onBack: () => void;
  onPick: (contact: NoteContact) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    top.current?.closest(".t-page")?.scrollTo({ top: 0 });
  }, [active]);

  // Read again each time the screen opens, but kept as the same value when
  // nothing has changed: the lists below are a few hundred entries and are
  // rebuilt on every change of this one.
  const [recentIds, setRecentIds] = useState(recentContacts.get);
  useEffect(() => {
    if (!active) return;
    const next = recentContacts.get();
    setRecentIds((current) => (current.join() === next.join() ? current : next));
  }, [active]);

  const { recent, rest } = useMemo(() => {
    const needle = query.trim();
    const pool = contacts.contacts;
    if (needle) {
      const found = pool.map((contact) => match(contact, needle)).filter((found): found is Match => !!found);
      return { recent: [] as Match[], rest: found };
    }
    const recent = recentIds
      .map((id) => pool.find((contact) => contact.id === id))
      .filter((contact): contact is Contact => !!contact)
      .map((contact) => ({ contact }));
    return {
      recent,
      rest: pool.filter((contact) => !recentIds.includes(contact.id)).map((contact) => ({ contact })),
    };
  }, [contacts.contacts, query, recentIds]);

  // Stable, so the memoised rows are not invalidated on every render.
  const pick = useCallback(
    (contact: Contact | null) =>
      onPick(contact ? { id: contact.id, name: contact.name, company: contact.company } : null),
    [onPick],
  );

  const loading = contacts.status === "loading" && contacts.contacts.length === 0;

  // The rows are memoised one by one, but building a few hundred elements is
  // itself work, and the screen re-renders on every change of the note above
  // it — including while the page is sliding in. The tree is held here so it
  // is only built when the lists themselves change.
  const groups = useMemo(
    () => (
      <>
        {recent.length > 0 && <ContactGroup title="Récents" contacts={recent} onPick={pick} />}
        {rest.length > 0 && (
          <ContactGroup title={recent.length ? "Tous les contacts" : undefined} contacts={rest} onPick={pick} />
        )}
      </>
    ),
    [recent, rest, pick],
  );

  return (
    <Screen className="relative">
      <div ref={top} />
      {/* The dictation is not played back here: it is transcribing in the
          background and there is nothing to check. The only question this
          screen asks is whose note it is. */}
      <TopBar title="À quel contact on rattache cette note ?" onBack={onBack} backLabel="Accueil" />

      {/* The search bar keeps the row to itself; the button beside it grows
          into the creation form and hides the screen as it travels. */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Nom, société ou téléphone"
            label="Rechercher un contact par nom, société ou téléphone"
          />
        </div>
        <MorphPanel
          open={creating}
          onOpen={() => setCreating(true)}
          label="Créer un contact"
          icon={
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
        >
          {creating && (
            <ContactForm
              typeOptions={contacts.typeOptions}
              initialName={query.trim()}
              onCancel={() => setCreating(false)}
              onCreated={(contact) => {
                setCreating(false);
                setQuery("");
                onCreated(contact);
                onPick({ id: contact.id, name: contact.name, company: contact.company });
              }}
            />
          )}
        </MorphPanel>
      </div>

      <button
        type="button"
        onClick={() => pick(null)}
        className="mt-6 flex min-h-16 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-3 text-left"
      >
        <span className="text-base font-medium text-navy">Sans contact</span>
        <span className="text-xs text-[color:var(--muted)]">Envoyer la note sans la rattacher</span>
      </button>

      {contacts.status === "error" && (
        <div className="mt-6 rounded-2xl bg-white-smoke p-4">
          <p className="text-base font-medium">Contacts indisponibles</p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">{contacts.error}</p>
          <TextButton onClick={onReload} className="-ml-3 mt-1">
            Réessayer
          </TextButton>
        </div>
      )}

      <div className={cn("contact-skel t-skel mt-6", !loading && "is-revealed", loading && "min-h-[360px]")}>
        <div className={cn("t-skel-skeleton flex flex-col gap-2", loading && "is-pulsing")} aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-white-smoke" />
          ))}
        </div>
        <div className="t-skel-content" aria-busy={loading}>
          {groups}
          {!loading && contacts.status !== "error" && recent.length + rest.length === 0 && (
            <p className="py-6 text-base text-[color:var(--muted)]">
              {query ? `Aucun contact ne correspond à « ${query} ».` : "Aucun contact dans ce filtre."}
            </p>
          )}
        </div>
      </div>
    </Screen>
  );
}

function ContactGroup({
  title,
  contacts,
  onPick,
}: {
  title?: string;
  contacts: Match[];
  onPick: (contact: Contact) => void;
}) {
  return (
    <section className="mb-6">
      {title && (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">{title}</h2>
      )}
      <ul className="flex flex-col gap-2">
        {contacts.map(({ contact, phone }) => (
          <ContactRow key={contact.id} contact={contact} phone={phone} onPick={onPick} />
        ))}
      </ul>
    </section>
  );
}

// Memoised: the list holds a few hundred rows, and the screen re-renders
// whenever the note or the page changes around it.
const ContactRow = memo(function ContactRow({
  contact,
  phone,
  onPick,
}: {
  contact: Contact;
  phone?: string;
  onPick: (contact: Contact) => void;
}) {
  // A number found by the search is shown, so the user sees why it matched.
  const detail = [contact.company, contact.role, phone].filter(Boolean).join(" · ");
  return (
    <li className="contact-row">
      <button
        type="button"
        onClick={() => onPick(contact)}
        className="flex min-h-16 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-3 text-left"
      >
        <span className="block truncate text-base font-medium">{contact.name}</span>
        {detail && <span className="block truncate text-xs text-[color:var(--muted)]">{detail}</span>}
      </button>
    </li>
  );
});
