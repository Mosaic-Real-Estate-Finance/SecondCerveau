import { useEffect, useRef, useState } from "react";
import type { ContactsState } from "@/App";
import { ContactForm, type ContactDraft } from "@/components/contact-form";
import { Icon, type IconName } from "@/components/icon";
import { PrimaryButton, TextButton } from "@/components/screen";
import { Sheet, SheetPages } from "@/components/sheet";
import {
  ignoreCall,
  retryCall,
  settleCall,
  type Closed,
  type ContactRef,
  type DecideBody,
  type PendingPerson,
  type ReviewItem,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatWhen } from "@/lib/when";
import { ContactPicker } from "./ContactPicker";

// One Read AI meeting waiting for a decision (/maquette.html is the reference
// it was designed on).
//
// One question per card — does this meeting go into Notion? — and two
// answers. Everything else is optional and one tap away on a person's row:
// filling the contact in before it is made, pointing at an existing one, or
// leaving that one person out. « Ajouter cette note » sends every choice in
// one request (/api/readai/settle); nothing is written before it.

/** What the card will ask the server for one person still open. */
type Choice =
  | { kind: "create"; draft?: ContactDraft }
  | { kind: "attach"; contact: ContactRef }
  | { kind: "skip" }
  // A contact of the same address exists: asked before anything is sent.
  | null;

type Row = {
  email: string;
  /** Empty when Read AI gave none: the row then shows the address alone. */
  name: string;
  firstName: string;
  /** In Notion already: recognised by the server. */
  known: boolean;
  /** Settled before this card was drawn, by a colleague. */
  settled?: PendingPerson["decision"];
  person?: PendingPerson;
  choice: Choice;
};

type Status = "open" | "adding" | "added" | "ignored";

// After Notion has answered, the rows turn to ✓ one after another.
const STEP_MS = 220;
const SETTLE_MS = 700;
// « Ignorer » waits this long before it is sent, so « Annuler » can still
// take it back.
const UNDO_MS = 5000;

/** A name worth showing: Read AI sometimes has none, or only the address again. */
const realName = (name: string | undefined) => (name && !name.includes("@") ? name.trim() : "");

/** marie.durand@kandbaz.fr → « Marie Durand »: a start for a contact with no name. */
const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// First and last names when Read AI gives both; otherwise the name it shows,
// which is fuller than a first name alone; with none, one read off the address.
const fullName = (person: PendingPerson) =>
  person.firstName && person.lastName
    ? `${person.firstName} ${person.lastName}`
    : realName(person.name) || nameFromEmail(person.email);

/** The contact made when nothing more is said: name, address, the suggested company. */
const defaultContact = (person: PendingPerson) => ({
  name: fullName(person),
  phones: [],
  types: [],
  companyId: person.companies[0]?.id,
});

const rowsOf = (item: ReviewItem): Row[] => {
  const open: Row[] = [];
  const settled: Row[] = [];
  for (const person of item.people) {
    const row: Row = {
      email: person.email,
      name: realName(person.name),
      firstName: person.firstName || realName(person.name).split(" ")[0] || person.email,
      known: false,
      person,
      settled: person.decision,
      choice: person.candidates.length ? null : { kind: "create" },
    };
    (person.decision ? settled : open).push(row);
  }
  const known = item.recognized.map<Row>((contact) => ({
    email: contact.email,
    name: realName(contact.name),
    firstName: realName(contact.name).split(" ")[0] || contact.email,
    known: true,
    choice: null,
  }));
  // The ones the decision is about come first.
  return [...open, ...settled, ...known];
};

const isOpen = (row: Row) => !row.known && !row.settled;
/** A person whose row ends with a ✓: written to Notion by this card. */
const writes = (row: Row) => isOpen(row) && (row.choice?.kind === "create" || row.choice?.kind === "attach");

export function MeetingCard({
  item,
  contacts,
  focused,
  onClosed,
  onReplace,
  onFailed,
  onReload,
  onExcluded,
}: {
  item: ReviewItem;
  contacts: ContactsState;
  focused: boolean;
  /** Gone from the queue: the count goes down. */
  onClosed: (id: string) => void;
  onReplace: (item: ReviewItem) => void;
  onFailed: (cause: unknown) => void;
  /** The queue changed under the card (a report processed again): read it again. */
  onReload: () => void;
  /** « Toujours ignorer »: the screen says so at the bottom. */
  onExcluded: (names: string[]) => void;
}) {
  const [rows, setRows] = useState(() => rowsOf(item));
  const [status, setStatus] = useState<Status>("open");
  const [noteUrl, setNoteUrl] = useState<string | null>(null);
  const [created, setCreated] = useState(0);
  // « Toujours ignorer »: sent at once, undone in Réglages rather than here.
  const [excludedNames, setExcludedNames] = useState<string[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
  // An « Ignorer » not sent yet: sent at once if the card goes away first.
  const pendingIgnore = useRef<number | null>(null);

  // The server's copy changed (a colleague, a retry): the card follows it.
  useEffect(() => {
    if (status === "open") setRows(rowsOf(item));
    // Only when the item does, not when the card's own status moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      if (pendingIgnore.current !== null) {
        window.clearTimeout(pendingIgnore.current);
        void ignoreCall(item.id).catch(() => undefined);
      }
    },
    [item.id],
  );

  const choose = (email: string, choice: Choice) =>
    setRows((list) => list.map((row) => (row.email === email ? { ...row, choice } : row)));

  const unanswered = rows.filter((row) => isOpen(row) && row.choice === null);
  const toCreate = rows.filter((row) => isOpen(row) && row.choice?.kind === "create");
  const complete = item.kind === "complete";

  const add = async (list = rows) => {
    setStatus("adding");
    const people = list.filter(isOpen).map((row) => {
      const choice = row.choice!;
      const body: Exclude<DecideBody, { action: "exclude" }> =
        choice.kind === "attach"
          ? { action: "attach", contactId: choice.contact.id }
          : choice.kind === "create"
            ? { action: "create", contact: choice.draft?.contact ?? defaultContact(row.person!) }
            : { action: "skip" };
      return { email: row.email, ...body };
    });
    try {
      const result = await settleCall(item.id, people);
      if (!("closed" in result)) {
        setStatus("open");
        return onReplace(result.item);
      }
      const written = list.filter(writes);
      setCreated(written.filter((row) => row.choice?.kind === "create").length);
      setNoteUrl(result.noteUrl);
      written.forEach((row, index) => later(index * STEP_MS, () => setDone((set) => new Set(set).add(row.email))));
      later(written.length * STEP_MS + SETTLE_MS, () => {
        setStatus("added");
        onClosed(item.id);
      });
    } catch (cause) {
      setStatus("open");
      onFailed(cause);
    }
  };

  const ignore = async (forever: boolean) => {
    setRefusing(false);
    setStatus("ignored");
    if (!forever) {
      pendingIgnore.current = window.setTimeout(() => {
        pendingIgnore.current = null;
        void ignoreCall(item.id).then(
          () => onClosed(item.id),
          (cause) => {
            setStatus("open");
            onFailed(cause);
          },
        );
      }, UNDO_MS);
      return;
    }
    // Sent at once: the setting it points to must already list them.
    setExcludedNames(toCreate.map((row) => row.name || row.email));
    try {
      await ignoreCall(item.id, toCreate.map((row) => row.email));
      onClosed(item.id);
      onExcluded(toCreate.map((row) => row.name || row.email));
    } catch (cause) {
      setStatus("open");
      setExcludedNames([]);
      onFailed(cause);
    }
  };

  const undo = () => {
    if (pendingIgnore.current === null) return;
    window.clearTimeout(pendingIgnore.current);
    pendingIgnore.current = null;
    setStatus("open");
  };

  if (item.status === "error") {
    return <FailedCard item={item} onClosed={onClosed} onFailed={onFailed} onReload={onReload} />;
  }

  const editingRow = rows.find((row) => row.email === editing) ?? null;
  const busy = status === "adding";
  const finished = status === "added" || status === "ignored";
  const meeting = item.meeting;

  return (
    <div>
      <div className={cn("meeting-collapse", finished && "is-closed")}>
        <div className="meeting-collapse-inner">
          <article className={cn("rounded-2xl bg-white-smoke p-4", focused && "ring-2 ring-navy")}>
            <header className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold leading-snug">{meeting.title || "Réunion sans titre"}</h3>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                  {[formatWhen(new Date(meeting.start)), meeting.owner?.name, complete && "Note déjà dans Notion"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {meeting.summary && (
                <button
                  type="button"
                  onClick={() => setSummary(true)}
                  aria-label="Lire le résumé"
                  title="Lire le résumé"
                  className="tap-target -mr-2 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy"
                >
                  <Icon name="quote.bubble" className="h-[18px]" />
                </button>
              )}
            </header>

            <h4 className="mt-3 px-1 text-2xs font-semibold uppercase tracking-wide text-[color:var(--muted)]">
              Présence des contacts dans le CRM
            </h4>
            <ul className="mt-1.5 rounded-xl bg-white">
              {rows.map((row, index) => (
                <PersonRow
                  key={row.email}
                  row={row}
                  first={index === 0}
                  working={busy && writes(row) && !done.has(row.email)}
                  done={done.has(row.email)}
                  onOpen={busy || !isOpen(row) ? undefined : () => setEditing(row.email)}
                  onAnswer={(same) =>
                    same && row.person!.candidates.length === 1
                      ? choose(row.email, { kind: "attach", contact: row.person!.candidates[0] })
                      : same
                        ? setEditing(row.email)
                        : choose(row.email, { kind: "create" })
                  }
                />
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <PrimaryButton
                onClick={() => (unanswered.length ? setConfirming(true) : void add())}
                disabled={busy}
                className="h-12 flex-1 whitespace-nowrap rounded-xl px-3"
              >
                {busy ? "Ajout en cours…" : complete ? "Ajouter à la note" : "Ajouter cette note"}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => setRefusing(true)}
                disabled={busy}
                className="h-12 flex-1 whitespace-nowrap rounded-xl bg-white px-3 font-medium text-navy disabled:opacity-40"
              >
                Ne pas ajouter
              </button>
            </div>
          </article>
        </div>
      </div>

      <Outcome
        status={status}
        title={meeting.title}
        complete={complete}
        created={created}
        noteUrl={noteUrl}
        excluded={excludedNames}
        onUndo={undo}
      />

      <Sheet open={summary} onClose={() => setSummary(false)} label="Résumé">
        <SummarySheet item={item} onClose={() => setSummary(false)} />
      </Sheet>

      <Sheet open={confirming} onClose={() => setConfirming(false)} label="Même personne ?">
        {confirming && unanswered.length > 0 && (
          <SamePersonSheet
            key={unanswered[0].email}
            row={unanswered[0]}
            left={unanswered.length}
            onAnswer={(choice) => {
              const next = rows.map((row) => (row.email === unanswered[0].email ? { ...row, choice } : row));
              setRows(next);
              // The last one answered: the note goes in, as asked.
              if (unanswered.length === 1) {
                setConfirming(false);
                void add(next);
              }
            }}
            onPick={() => {
              setConfirming(false);
              setEditing(unanswered[0].email);
            }}
            onCancel={() => setConfirming(false)}
          />
        )}
      </Sheet>

      <Sheet open={refusing} onClose={() => setRefusing(false)} label="Ne pas ajouter">
        <RefuseSheet
          complete={complete}
          people={toCreate}
          onIgnore={(forever) => void ignore(forever)}
          onCancel={() => setRefusing(false)}
        />
      </Sheet>

      {editingRow && (
        <PersonSheet
          key={editingRow.email}
          row={editingRow}
          contacts={contacts}
          onChoose={(choice) => {
            choose(editingRow.email, choice);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ---- A person -----------------------------------------------------------------

function settledText(decision: NonNullable<Row["settled"]>) {
  if (decision.action === "attach") return `Rattaché à ${decision.name}`;
  if (decision.action === "create") return `Créé dans Notion : ${decision.name}`;
  if (decision.action === "skip") return "Ne rejoindra pas le CRM";
  return "Dans les contacts exclus";
}

function PersonRow({
  row,
  first,
  working,
  done,
  onOpen,
  onAnswer,
}: {
  row: Row;
  first: boolean;
  working: boolean;
  done: boolean;
  onOpen?: () => void;
  onAnswer: (same: boolean) => void;
}) {
  const choice = row.choice;
  const skipped = choice?.kind === "skip" || row.settled?.action === "skip" || row.settled?.action === "exclude";
  const linked = choice?.kind === "attach";
  const inNotion = row.known || linked || done || row.settled?.action === "attach" || row.settled?.action === "create";
  const icon: IconName = skipped ? "minus.circle" : inNotion ? "checkmark.circle" : "xmark.circle";
  const note = row.settled
    ? settledText(row.settled)
    : done
      ? linked
        ? `Adresse ajoutée à ${choice.contact.name}`
        : "Créé dans Notion"
      : skipped
        ? "Ne rejoindra pas le CRM"
        : linked
          ? `Rattaché à ${[choice.contact.name, choice.contact.company].filter(Boolean).join(" · ")}`
          : choice?.kind === "create" && choice.draft
            ? "Fiche complétée"
            : null;
  const tip = skipped
    ? `${row.firstName} ne rejoindra pas le CRM`
    : inNotion
      ? `${row.firstName} existe déjà dans Notion`
      : `${row.firstName} n'existe pas dans Notion`;
  const candidates = row.person?.candidates ?? [];
  const asking = choice === null && !row.known && !row.settled && candidates.length > 0;

  const line = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="person-tip relative flex shrink-0" data-tip={tip}>
        <span className={cn("person-icon flex shrink-0", done && "is-flipped")}>
          <Icon
            name={icon}
            className={cn(
              "h-[18px]",
              icon === "checkmark.circle" ? "text-navy" : icon === "minus.circle" ? "text-[color:var(--muted)]" : "text-midnight-blue",
            )}
          />
        </span>
        <span className="sr-only">{tip}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span className={cn("text-[14px] font-medium", skipped && "text-[color:var(--muted)] line-through")}>
            {row.name || row.email}
          </span>
          {row.name && <span className="text-xs text-[color:var(--muted)]">, {row.email}</span>}
        </span>
        {note && <span className="block truncate text-xs text-[color:var(--muted)]">{note}</span>}
      </span>
      {onOpen && <Icon name="square.and.pencil" className="h-[17px] shrink-0 text-[color:var(--muted)]" />}
    </span>
  );

  return (
    <li className={cn(!first && "border-t border-[color:var(--hairline)]", working && "person-working")}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${row.name || row.email} : options`}
          className="tap-target flex min-h-11 w-full items-center px-3 py-2 text-left"
        >
          {line}
        </button>
      ) : (
        <div className="flex min-h-11 items-center px-3 py-2">{line}</div>
      )}
      {asking && (
        <div className="-mt-1 px-3 pb-3 pl-[38px]">
          <p className="text-xs leading-snug">
            {candidates.length === 1 ? (
              <>
                Déjà dans Notion sous <span className="font-medium">{candidates[0].name}</span>
                {candidates[0].company && ` · ${candidates[0].company}`}&nbsp;?
              </>
            ) : (
              <>Cette adresse est sur {candidates.length} fiches dans Notion. L'une d'elles&nbsp;?</>
            )}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="tap-target h-6 rounded-full bg-white-smoke px-2.5 text-[11px] font-medium text-navy"
            >
              {candidates.length === 1 ? "Oui, même personne" : "Choisir la fiche"}
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="tap-target h-6 rounded-full bg-white-smoke px-2.5 text-[11px] font-medium text-navy"
            >
              Non
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

// ---- After the decision ---------------------------------------------------------

function Outcome({
  status,
  title,
  complete,
  created,
  noteUrl,
  excluded,
  onUndo,
}: {
  status: Status;
  title: string;
  complete: boolean;
  created: number;
  noteUrl: string | null;
  excluded: string[];
  onUndo: () => void;
}) {
  const shown = status === "added" || status === "ignored";
  const added = status === "added";
  return (
    <div className={cn("meeting-collapse", !shown && "is-closed")}>
      <div className="meeting-collapse-inner">
        <div className="flex min-h-14 items-center gap-3 rounded-2xl bg-white-smoke px-4 py-2">
          <Icon name={added ? "checkmark.circle" : "minus.circle"} className="h-5 text-navy" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {added ? (noteUrl ? "Note ajoutée dans Notion" : "Réunion close") : "Réunion ignorée"}
            </span>
            <span className="block truncate text-xs text-[color:var(--muted)]">
              {added
                ? created
                  ? `${title} · ${created} contact${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""}`
                  : noteUrl
                    ? title
                    : "Personne à ajouter : aucune note écrite"
                : excluded.length
                  ? `${listOf(excluded)} dans les contacts exclus`
                  : complete
                    ? "La note existante n'a pas été modifiée"
                    : "Rien n'a été écrit dans Notion"}
            </span>
          </span>
          {added ? (
            noteUrl && (
              <a href={noteUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-navy">
                Ouvrir ↗
              </a>
            )
          ) : (
            !excluded.length && (
              <TextButton onClick={onUndo} className="-mr-3 shrink-0 text-xs">
                Annuler
              </TextButton>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Sheets -------------------------------------------------------------------

/** « A », « A et B », « ces 3 personnes ». */
export function listOf(names: string[]) {
  return names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} et ${names[1]}`
      : `ces ${names.length} personnes`;
}

function RefuseSheet({
  complete,
  people,
  onIgnore,
  onCancel,
}: {
  complete: boolean;
  people: Row[];
  onIgnore: (forever: boolean) => void;
  onCancel: () => void;
}) {
  const names = listOf(people.map((person) => person.name || person.email));
  return (
    <div>
      <h2 className="font-serif text-2xl">
        {complete && people.length ? `Ne pas ajouter ${names} ?` : "Ne pas ajouter cette note ?"}
      </h2>
      <p className="mt-2 text-[color:var(--muted)]">
        {complete
          ? `La note est déjà dans Notion, enregistrée par un collègue. Elle n'est ni modifiée ni supprimée${
              people.length ? ` : aucune fiche n'est créée pour ${names}.` : "."
            }`
          : "Rien ne sera écrit dans Notion."}
      </p>
      <PrimaryButton onClick={() => onIgnore(false)} className="mt-6">
        Ignorer cette réunion
      </PrimaryButton>
      {people.length > 0 && (
        <button
          type="button"
          onClick={() => onIgnore(true)}
          className="mt-2 flex min-h-14 w-full items-center justify-center rounded-2xl bg-white-smoke px-4 py-3 text-center font-medium text-navy"
        >
          Toujours ignorer {names}
        </button>
      )}
      <div className="mt-2 flex justify-center">
        <TextButton onClick={onCancel}>Annuler</TextButton>
      </div>
    </div>
  );
}

function SamePersonSheet({
  row,
  left,
  onAnswer,
  onPick,
  onCancel,
}: {
  row: Row;
  left: number;
  onAnswer: (choice: Choice) => void;
  onPick: () => void;
  onCancel: () => void;
}) {
  const candidates = row.person!.candidates;
  const one = candidates.length === 1 ? candidates[0] : null;
  return (
    <div>
      <h2 className="font-serif text-2xl">Est-ce la même personne&nbsp;?</h2>
      <p className="mt-2 text-[color:var(--muted)]">
        {one
          ? `Une fiche existe déjà dans Notion pour ${row.email}.`
          : `${row.email} est déjà sur ${candidates.length} fiches dans Notion.`}
      </p>
      {one && (
        <div className="mt-4 rounded-2xl bg-white-smoke px-4 py-3">
          <p className="font-medium">{one.name}</p>
          <p className="text-xs text-[color:var(--muted)]">
            {[one.company, "déjà dans Notion"].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
      <PrimaryButton onClick={() => (one ? onAnswer({ kind: "attach", contact: one }) : onPick())} className="mt-6">
        {one ? "Oui, l'associer à cette fiche" : "Choisir la fiche"}
      </PrimaryButton>
      <button
        type="button"
        onClick={() => onAnswer({ kind: "create" })}
        className="mt-2 flex min-h-14 w-full items-center justify-center rounded-2xl bg-white-smoke px-4 py-3 text-center font-medium text-navy"
      >
        Non, créer un nouveau contact
      </button>
      <div className="mt-2 flex justify-center">
        <TextButton onClick={onCancel}>Annuler</TextButton>
      </div>
      {left > 1 && (
        <p className="mt-1 text-center text-xs text-[color:var(--muted)]">
          Encore {left - 1} question{left > 2 ? "s" : ""} ensuite.
        </p>
      )}
    </div>
  );
}

function SummarySheet({ item, onClose }: { item: ReviewItem; onClose: () => void }) {
  const meeting = item.meeting;
  return (
    <div>
      {/* Stays put while a long summary scrolls under it, blurred away. */}
      <header className="summary-head sticky -top-1 z-10 -mx-4 flex items-start justify-between gap-3 px-4 pb-3 pt-1">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight">{meeting.title || "Réunion sans titre"}</h2>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {[formatWhen(new Date(meeting.start)), meeting.owner?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
        <TextButton onClick={onClose} className="-mr-3 shrink-0">
          OK
        </TextButton>
      </header>
      <div className="mt-1 flex flex-col gap-3 leading-relaxed">
        {meeting.summary.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index} className="whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}

// ---- A person's options: one sheet, three pages side by side ---------------------

const OPTION_ICON_SIZE: Partial<Record<IconName, string>> = {
  "square.and.pencil": "h-[22px]",
  "person.line.dotted.person": "h-[17px]",
  "person.fill.xmark": "h-[17px]",
};

function Option({ icon, title, detail, onClick }: { icon: IconName; title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl bg-white-smoke p-4 text-left">
      {/* Sized by eye, not by file: the pencil is a thin outline inside a
          margin, the people are solid shapes, the pair twice as wide. The
          heights in OPTION_ICON_SIZE give the three the same presence. */}
      <span className="flex w-9 shrink-0 justify-center text-navy">
        <Icon name={icon} className={OPTION_ICON_SIZE[icon]} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-[color:var(--muted)]">{detail}</span>
      </span>
      <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--muted)]">
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function PersonSheet({
  row,
  contacts,
  onChoose,
  onClose,
}: {
  row: Row;
  contacts: ContactsState;
  onChoose: (choice: Choice) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<"menu" | "form" | "picker">("menu");
  // Mounted closed, then opened: the sheet rises instead of appearing.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  const close = () => {
    setOpen(false);
    window.setTimeout(onClose, 520);
  };
  const choose = (choice: Choice) => {
    setOpen(false);
    window.setTimeout(() => onChoose(choice), 520);
  };
  const person = row.person!;
  const draft = row.choice?.kind === "create" ? row.choice.draft : undefined;

  const content =
    page === "form" ? (
      <ContactForm
        typeOptions={contacts.typeOptions}
        initialName={fullName(person)}
        initial={draft}
        email={person.email}
        companyChoices={person.companies}
        title="Créer le contact"
        submitLabel="Enregistrer"
        footnote="Le contact est créé quand la note est ajoutée."
        onBack={() => setPage("menu")}
        onCancel={() => setPage("menu")}
        // Kept here, not sent: the contact is made with the note.
        submit={async (contact, company) => {
          choose({ kind: "create", draft: { contact, company } });
          return { id: "", name: contact.name, company: company?.name ?? "", role: contact.role ?? "", types: contact.types, phones: [], createdAt: "" };
        }}
        onCreated={() => undefined}
      />
    ) : page === "picker" ? (
      <ContactPicker
        person={person}
        contacts={contacts}
        onBack={() => setPage("menu")}
        onPick={(contact) => choose({ kind: "attach", contact })}
      />
    ) : (
      <div>
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-serif text-2xl">{row.name || row.email}</h2>
            {row.name && <p className="truncate text-xs text-[color:var(--muted)]">{row.email}</p>}
          </div>
          <TextButton onClick={close} className="-mr-3 shrink-0">
            OK
          </TextButton>
        </header>
        <div className="flex flex-col gap-2">
          <Option
            icon="square.and.pencil"
            title="Créer le contact"
            detail="Sa fiche, pré-remplie d'après son mail, à vérifier ou compléter."
            onClick={() => setPage("form")}
          />
          <Option
            icon="person.line.dotted.person"
            title="Associer à un contact existant"
            detail="Son adresse est ajoutée à sa fiche, rien n'est créé."
            onClick={() => setPage("picker")}
          />
          {row.choice?.kind !== "skip" && (
            <Option
              icon="person.fill.xmark"
              title="Ne pas l'ajouter au CRM"
              detail="La note est ajoutée sans cette personne."
              onClick={() => choose({ kind: "skip" })}
            />
          )}
        </div>
      </div>
    );

  return (
    <Sheet open={open} onClose={close} label={row.name || row.email} full={page !== "menu"}>
      <SheetPages id={page} depth={page === "menu" ? 0 : 1} onBack={() => setPage("menu")}>
        {content}
      </SheetPages>
    </Sheet>
  );
}

// ---- A report that could not be processed ----------------------------------------

function FailedCard({
  item,
  onClosed,
  onFailed,
  onReload,
}: {
  item: ReviewItem;
  onClosed: (id: string) => void;
  onFailed: (cause: unknown) => void;
  onReload: () => void;
}) {
  const [state, setState] = useState<"failed" | "retrying" | "gone">("failed");
  const run = async (work: () => Promise<Closed | { outcome: string }>) => {
    setState("retrying");
    try {
      const result = await work();
      setState("gone");
      // Closed, or processed again into a new item that the list must read.
      if ("closed" in result) onClosed(item.id);
      else onReload();
    } catch (cause) {
      setState("failed");
      onFailed(cause);
    }
  };
  const meeting = item.meeting;
  return (
    <div className={cn("meeting-collapse", state === "gone" && "is-closed")}>
      <div className="meeting-collapse-inner">
        <article className="rounded-2xl bg-white-smoke p-4">
          <h3 className="text-base font-semibold leading-snug">{meeting.title || "Réunion sans titre"}</h3>
          <p className="mt-0.5 text-xs text-[color:var(--muted)]">
            {[formatWhen(new Date(meeting.start)), meeting.owner?.name].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-3 rounded-xl bg-white px-3 py-2.5 text-xs leading-snug">
            <span className="font-medium">Pas encore dans Notion.</span>{" "}
            {item.stage === "close"
              ? "Les choix sont gardés, mais Notion n'a pas répondu au moment d'écrire la note. Rien n'est perdu : réessayez."
              : "Read AI a bien envoyé le rapport, mais Notion n'a pas répondu (indisponible ou trop lent). Rien n'est perdu : réessayez."}
          </p>
          <div className="mt-3 flex gap-2">
            <PrimaryButton
              onClick={() => void run(() => retryCall(item.id))}
              disabled={state !== "failed"}
              className="h-12 flex-1 whitespace-nowrap rounded-xl px-3"
            >
              {state === "retrying" ? "Nouvel essai…" : "Réessayer"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => void run(() => ignoreCall(item.id))}
              disabled={state !== "failed"}
              className="h-12 flex-1 whitespace-nowrap rounded-xl bg-white px-3 font-medium text-navy disabled:opacity-40"
            >
              Ignorer
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
