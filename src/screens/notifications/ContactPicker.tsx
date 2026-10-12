import { useMemo, useState } from "react";
import type { ContactsState } from "@/App";
import { TextButton } from "@/components/screen";
import { SearchField } from "@/components/search-field";
import type { Contact, ContactRef, PendingPerson } from "@/lib/api";
import { fold, match } from "@/screens/ContactScreen";

/** The contacts, searchable, with the suggested ones on top. A page of the person's sheet. */
export function ContactPicker({
  person,
  contacts,
  onBack,
  onPick,
}: {
  person: PendingPerson;
  contacts: ContactsState;
  onBack: () => void;
  onPick: (contact: ContactRef) => void;
}) {
  const [query, setQuery] = useState("");
  const suggestedNames = useMemo(
    () => person.companies.map((company) => fold(company.name)).filter(Boolean),
    [person.companies],
  );
  const { suggested, rest } = useMemo(() => {
    const needle = query.trim();
    const pool = needle ? contacts.contacts.filter((contact) => match(contact, needle)) : contacts.contacts;
    const candidateIds = new Set(person.candidates.map((contact) => contact.id));
    const isSuggested = (contact: Contact) =>
      candidateIds.has(contact.id) ||
      (suggestedNames.length > 0 &&
        contact.company.split(",").some((name) => suggestedNames.includes(fold(name.trim()))));
    return {
      suggested: pool.filter(isSuggested),
      rest: pool.filter((contact) => !isSuggested(contact)).slice(0, needle ? 50 : 30),
    };
  }, [contacts.contacts, person.candidates, query, suggestedNames]);

  const row = (contact: ContactRef) => (
    <li key={contact.id}>
      <button
        type="button"
        onClick={() => onPick({ id: contact.id, name: contact.name, company: contact.company })}
        className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-2 text-left"
      >
        <span className="block truncate text-base font-medium">{contact.name}</span>
        {contact.company && <span className="block truncate text-xs text-[color:var(--muted)]">{contact.company}</span>}
      </button>
    </li>
  );

  // The same address on contacts the list does not hold yet (still loading,
  // or beyond its first page): offered all the same.
  const missing = person.candidates.filter(
    (candidate) => !contacts.contacts.some((contact) => contact.id === candidate.id),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 pb-4">
        <TextButton onClick={onBack} className="-ml-3 flex items-center gap-1">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Retour
        </TextButton>
        <h2 className="mt-1 font-serif text-2xl">Quel contact&nbsp;?</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          {person.email} sera ajoutée aux adresses du contact choisi.
        </p>
      </div>
      <SearchField value={query} onChange={setQuery} placeholder="Nom, société ou téléphone" label="Rechercher un contact" />
      <div className="morph-scroll -mx-1 mt-4 flex min-h-0 flex-1 flex-col gap-4 px-1 pb-4">
        {missing.length > 0 && <ul className="flex flex-col gap-2">{missing.map(row)}</ul>}
        {suggested.length > 0 && (
          <section>
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Suggérés</h3>
            <ul className="flex flex-col gap-2">{suggested.map(row)}</ul>
          </section>
        )}
        <section>
          {suggested.length > 0 && (
            <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Tous les contacts
            </h3>
          )}
          <ul className="flex flex-col gap-2">{rest.map(row)}</ul>
          {contacts.status === "loading" && <p className="text-[color:var(--muted)]">Chargement des contacts…</p>}
          {contacts.status === "ready" && !suggested.length && !rest.length && !missing.length && (
            <p className="px-2 text-[color:var(--muted)]">Aucun contact ne correspond.</p>
          )}
        </section>
      </div>
    </div>
  );
}
