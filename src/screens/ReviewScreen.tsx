import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContactsState } from "@/App";
import { ContactForm } from "@/components/contact-form";
import { Sheet } from "@/components/sheet";
import { CircleButton, Screen, TextButton, TopBar } from "@/components/screen";
import { SearchField } from "@/components/search-field";
import { useToast } from "@/components/toast";
import {
  ApiError,
  decidePerson,
  fetchReview,
  ignoreCall,
  retryCall,
  type Closed,
  type Contact,
  type DecideBody,
  type NewContact,
  type PendingPerson,
  type ReviewItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { fold, match } from "@/screens/ContactScreen";

// « À valider » (brief §8): the meetings Read AI sent that name someone the
// CRM does not know. Nothing about them is in Notion until every person is
// settled here — attached to a contact, created as one, or set aside.

const stamp = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : stamp.format(date);
};

const linkIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" />
    <path d="M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" />
  </svg>
);

const plusIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

type Panel = { itemId: string; email: string; kind: "attach" | "create" } | null;

type Creator = (item: ReviewItem, person: PendingPerson, contact: NewContact) => Promise<Contact>;

export function ReviewScreen({
  active,
  contacts,
  focusId,
  onBack,
  onCount,
  onContactCreated,
  onUnauthorized,
}: {
  active: boolean;
  contacts: ContactsState;
  /** Opened from a notification: the item to bring into view. */
  focusId: string | null;
  onBack: () => void;
  onCount: (count: number) => void;
  onContactCreated: (contact: Contact) => void;
  onUnauthorized: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const load = useCallback(async () => {
    setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const data = await fetchReview();
      setItems(data.items);
      setStatus("ready");
      onCount(data.count);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return onUnauthorized();
      setError((cause as Error).message);
      setStatus("error");
    }
  }, [onCount, onUnauthorized]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    if (!active || !focusId || status !== "ready") return;
    document.getElementById(`review-${focusId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [active, focusId, status]);

  const replace = (item: ReviewItem) => setItems((list) => list.map((one) => (one.id === item.id ? item : one)));
  const drop = (id: string) =>
    setItems((list) => {
      const next = list.filter((one) => one.id !== id);
      onCount(next.length);
      return next;
    });

  const closed = (id: string, result: Closed) => {
    drop(id);
    toast.show(result.noteUrl ? "Note créée dans Notion." : "Appel clos, rien n'a été écrit dans Notion.");
  };

  /** Errors as the routes describe them; a failed note hands its item back. */
  const failed = (cause: unknown) => {
    if (cause instanceof ApiError) {
      if (cause.status === 401) return onUnauthorized();
      const item = cause.data?.item as ReviewItem | undefined;
      if (item) replace(item);
      if (cause.data?.code === "decided" || cause.data?.code === "gone") {
        toast.show(cause.message);
        return void load();
      }
    }
    toast.show((cause as Error).message);
  };

  const decide = async (item: ReviewItem, person: PendingPerson, body: DecideBody) => {
    setBusy(`${item.id}:${person.email}`);
    try {
      const result = await decidePerson(item.id, person.email, body);
      setPanel(null);
      if ("closed" in result) closed(item.id, result);
      else replace(result.item);
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(null);
    }
  };

  /**
   * « Créer » goes through the decision, not the dictation's contact route.
   * A refusal stays in the form, which shows it and keeps what was typed; a
   * person settled meanwhile by someone else closes the form and refreshes.
   */
  const create: Creator = async (item, person, contact) => {
    let result;
    try {
      result = await decidePerson(item.id, person.email, { action: "create", contact });
    } catch (cause) {
      if (cause instanceof ApiError && (cause.data?.code === "decided" || cause.data?.code === "gone")) {
        setPanel(null);
        failed(cause);
      } else if (cause instanceof ApiError && cause.data?.item) {
        // The contact exists; it is the note that failed. The item says so.
        setPanel(null);
        failed(cause);
      }
      throw cause;
    }
    setPanel(null);
    const decision =
      "item" in result ? result.item.people.find((one) => one.email === person.email)?.decision : undefined;
    if ("closed" in result) closed(item.id, result);
    else replace(result.item);
    return {
      id: decision && "contactId" in decision ? decision.contactId : "",
      name: contact.name,
      company: "",
      role: contact.role ?? "",
      types: contact.types,
      phones: contact.phones.map((phone) => phone.number),
      createdAt: new Date().toISOString(),
    };
  };

  const ignore = async (item: ReviewItem) => {
    setBusy(item.id);
    try {
      await ignoreCall(item.id);
      drop(item.id);
      toast.show("Appel ignoré. Personne n'a été ajouté à la liste d'exclusion.");
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(null);
    }
  };

  const retry = async (item: ReviewItem) => {
    setBusy(item.id);
    try {
      const result = await retryCall(item.id);
      if ("closed" in result) closed(item.id, result);
      else await load();
    } catch (cause) {
      failed(cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <TopBar title="À valider" onBack={onBack} backLabel="Accueil" />
      <p className="-mt-3 mb-6 text-xs text-[color:var(--muted)]">
        Réunions Read AI avec une personne que le CRM ne connaît pas. Rien n'est écrit dans Notion avant votre décision.
      </p>

      {status === "loading" && <p className="text-base text-[color:var(--muted)]">Chargement…</p>}
      {status === "error" && (
        <div className="rounded-2xl bg-white-smoke p-4">
          <p className="text-base font-medium">File d'attente indisponible</p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">{error}</p>
          <TextButton onClick={() => void load()} className="-ml-3 mt-1">
            Réessayer
          </TextButton>
        </div>
      )}
      {status === "ready" && items.length === 0 && (
        <p className="py-6 text-base text-[color:var(--muted)]">Rien à valider.</p>
      )}

      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.id} id={`review-${item.id}`} className="scroll-mt-4">
            <CallCard
              item={item}
              focused={item.id === focusId}
              busy={busy}
              panel={panel}
              contacts={contacts}
              onPanel={setPanel}
              onDecide={decide}
              onIgnore={ignore}
              onRetry={retry}
              onCreate={create}
              onContactCreated={onContactCreated}
            />
          </li>
        ))}
      </ul>

    </Screen>
  );
}

function CallCard({
  item,
  focused,
  busy,
  panel,
  contacts,
  onPanel,
  onDecide,
  onIgnore,
  onRetry,
  onCreate,
  onContactCreated,
}: {
  item: ReviewItem;
  focused: boolean;
  busy: string | null;
  panel: Panel;
  contacts: ContactsState;
  onPanel: (panel: Panel) => void;
  onDecide: (item: ReviewItem, person: PendingPerson, body: DecideBody) => Promise<void>;
  onIgnore: (item: ReviewItem) => Promise<void>;
  onRetry: (item: ReviewItem) => Promise<void>;
  onCreate: Creator;
  onContactCreated: (contact: Contact) => void;
}) {
  const [summary, setSummary] = useState(false);
  const meeting = item.meeting;
  const open = item.people.filter((person) => !person.decision).length;

  return (
    <article className={cn("rounded-2xl bg-white-smoke p-4", focused && "ring-2 ring-navy")}>
      <header>
        <h2 className="font-serif text-xl leading-snug">{meeting.title || "Réunion sans titre"}</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          {[when(meeting.start), meeting.owner?.name && `organisée par ${meeting.owner.name}`].filter(Boolean).join(" · ")}
        </p>
        {item.kind === "complete" && (
          <p className="mt-2 text-xs">
            La note existe déjà ; les personnes validées y seront ajoutées.{" "}
            {item.noteUrl && (
              <a href={item.noteUrl} target="_blank" rel="noreferrer">
                Ouvrir la note
              </a>
            )}
          </p>
        )}
      </header>

      {item.status === "error" && (
        <div className="mt-3 rounded-xl bg-white p-3">
          <p className="text-sm font-medium">Réunion non enregistrée</p>
          {item.error && <p className="mt-1 text-xs text-[color:var(--muted)]">{item.error}</p>}
          <TextButton onClick={() => void onRetry(item)} disabled={busy === item.id} className="-ml-3 mt-1">
            {busy === item.id ? "Nouvel essai…" : "Réessayer"}
          </TextButton>
        </div>
      )}

      {item.recognized.length > 0 && (
        <div className="mt-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Déjà dans le CRM</h3>
          <p className="mt-1 text-sm">
            {item.recognized.map((contact) => [contact.name, contact.company].filter(Boolean).join(", ")).join(" · ")}
          </p>
        </div>
      )}

      {meeting.summary && (
        <div className="mt-3">
          <TextButton onClick={() => setSummary((on) => !on)} className="-ml-3 text-sm" aria-expanded={summary}>
            {summary ? "Masquer le résumé" : "Lire le résumé"}
          </TextButton>
          {summary && <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{meeting.summary}</p>}
        </div>
      )}

      {item.people.length > 0 && (
        <div className="mt-3">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            {open ? `${open} personne${open > 1 ? "s" : ""} à valider` : "Tout est tranché"}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {item.people.map((person) => (
              <PersonRow
                key={person.email}
                item={item}
                person={person}
                busy={busy === `${item.id}:${person.email}`}
                panel={panel}
                contacts={contacts}
                onPanel={onPanel}
                onDecide={onDecide}
                onCreate={onCreate}
                onContactCreated={onContactCreated}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {meeting.reportUrl ? (
          <a href={meeting.reportUrl} target="_blank" rel="noreferrer" className="text-sm">
            Rapport Read AI
          </a>
        ) : (
          <span />
        )}
        <TextButton onClick={() => void onIgnore(item)} disabled={busy === item.id} className="-mr-3 text-sm">
          Ignorer cet appel
        </TextButton>
      </div>
    </article>
  );
}

function decisionText(person: PendingPerson) {
  const decision = person.decision;
  if (!decision) return "";
  if (decision.action === "exclude") return "Pas nécessaire";
  return decision.action === "attach" ? `Rattaché à ${decision.name}` : `Contact créé : ${decision.name}`;
}

function PersonRow({
  item,
  person,
  busy,
  panel,
  contacts,
  onPanel,
  onDecide,
  onCreate,
  onContactCreated,
}: {
  item: ReviewItem;
  person: PendingPerson;
  busy: boolean;
  panel: Panel;
  contacts: ContactsState;
  onPanel: (panel: Panel) => void;
  onDecide: (item: ReviewItem, person: PendingPerson, body: DecideBody) => Promise<void>;
  onCreate: Creator;
  onContactCreated: (contact: Contact) => void;
}) {
  const isOpen = (kind: "attach" | "create") =>
    panel?.itemId === item.id && panel.email === person.email && panel.kind === kind;
  const suggestion = person.candidates.length
    ? `Même adresse sur : ${person.candidates.map((contact) => contact.name).join(", ")}`
    : person.companies.length
      ? `Société suggérée : ${person.companies.map((company) => company.name).filter(Boolean).join(" ou ")}`
      : "";
  // From the payload: first and last names when Read AI has them.
  const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ") || person.name;

  return (
    <li className="rounded-xl bg-white p-3">
      <p className="truncate text-base font-medium">{person.name}</p>
      <p className="truncate text-xs text-[color:var(--muted)]">{person.email}</p>
      {suggestion && <p className="mt-1 text-xs">{suggestion}</p>}

      {person.decision ? (
        <p className="mt-2 text-sm text-[color:var(--muted)]">✓ {decisionText(person)}</p>
      ) : (
        <div className="mt-2 flex items-end gap-3">
          <div className="flex flex-col items-center gap-1">
            <CircleButton
              onClick={() => onPanel({ itemId: item.id, email: person.email, kind: "attach" })}
              aria-label={`Rattacher ${person.name} à un contact existant`}
              aria-expanded={isOpen("attach")}
            >
              {linkIcon}
            </CircleButton>
            <Sheet open={isOpen("attach")} onClose={() => onPanel(null)} label="Rattacher à un contact" full>
              <ContactPicker
                person={person}
                contacts={contacts}
                busy={busy}
                onCancel={() => onPanel(null)}
                onPick={(contact) => void onDecide(item, person, { action: "attach", contactId: contact.id })}
              />
            </Sheet>
            <span className="text-2xs text-[color:var(--muted)]">Rattacher</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <CircleButton
              onClick={() => onPanel({ itemId: item.id, email: person.email, kind: "create" })}
              aria-label={`Créer un contact pour ${person.name}`}
              aria-expanded={isOpen("create")}
            >
              {plusIcon}
            </CircleButton>
            <Sheet open={isOpen("create")} onClose={() => onPanel(null)} label="Nouveau contact" full>
              <ContactForm
                typeOptions={contacts.typeOptions}
                initialName={fullName}
                email={person.email}
                companyChoices={person.companies}
                onCancel={() => onPanel(null)}
                // The contact is created by the decision itself, under the
                // queue's lock: two colleagues cannot create it twice.
                submit={(contact) => onCreate(item, person, contact)}
                onCreated={(contact) => {
                  if (contact.id) onContactCreated(contact);
                }}
              />
            </Sheet>
            <span className="text-2xs text-[color:var(--muted)]">Créer</span>
          </div>
          <div className="flex-1" />
          <TextButton
            onClick={() => void onDecide(item, person, { action: "exclude" })}
            disabled={busy}
            className="-mr-3 text-sm"
          >
            Pas nécessaire
          </TextButton>
        </div>
      )}
    </li>
  );
}

/** The contacts, searchable, with the suggested ones on top. */
function ContactPicker({
  person,
  contacts,
  busy,
  onCancel,
  onPick,
}: {
  person: PendingPerson;
  contacts: ContactsState;
  busy: boolean;
  onCancel: () => void;
  onPick: (contact: Contact | { id: string; name: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const suggestedNames = useMemo(
    () => person.companies.map((company) => fold(company.name)).filter(Boolean),
    [person.companies],
  );
  const { suggested, rest } = useMemo(() => {
    const needle = query.trim();
    const pool = needle
      ? contacts.contacts.filter((contact) => match(contact, needle))
      : contacts.contacts;
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

  const row = (contact: Contact) => (
    <li key={contact.id}>
      <button
        type="button"
        disabled={busy}
        onClick={() => onPick(contact)}
        className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-2 text-left disabled:opacity-40"
      >
        <span className="block truncate text-base font-medium">{contact.name}</span>
        {contact.company && <span className="block truncate text-xs text-[color:var(--muted)]">{contact.company}</span>}
      </button>
    </li>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between pb-4">
        <h2 className="font-serif text-xl">Rattacher {person.name}</h2>
        <TextButton onClick={onCancel} className="-mr-3">
          Annuler
        </TextButton>
      </div>
      <p className="-mt-2 mb-3 text-xs text-[color:var(--muted)]">
        {person.email} sera ajoutée aux adresses du contact choisi.
      </p>
      <SearchField value={query} onChange={setQuery} placeholder="Nom, société ou téléphone" label="Rechercher un contact" />
      <div className="morph-scroll -mx-1 mt-4 flex min-h-0 flex-1 flex-col gap-4 px-1 pb-4">
        {/* Contacts listed in the dictation's own list; a duplicate found in
            the base is offered even if that list is still loading. */}
        {person.candidates
          .filter((candidate) => !contacts.contacts.some((contact) => contact.id === candidate.id))
          .map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(candidate)}
              className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-2 text-left"
            >
              <span className="block truncate text-base font-medium">{candidate.name}</span>
              <span className="block truncate text-xs text-[color:var(--muted)]">{candidate.company}</span>
            </button>
          ))}
        {suggested.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Suggérés</h3>
            <ul className="flex flex-col gap-2">{suggested.map(row)}</ul>
          </section>
        )}
        <section>
          {suggested.length > 0 && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">Tous les contacts</h3>
          )}
          <ul className="flex flex-col gap-2">{rest.map(row)}</ul>
          {contacts.status === "loading" && <p className="text-sm text-[color:var(--muted)]">Chargement des contacts…</p>}
        </section>
      </div>
    </div>
  );
}
