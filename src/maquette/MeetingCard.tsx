import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { PrimaryButton, TextButton } from "@/components/screen";
import { Sheet, SheetPages } from "@/components/sheet";
import { cn } from "@/lib/utils";
import { CONTACTS, TYPES, type Meeting, type Person } from "./data";

// One Read AI meeting waiting for a decision, as the « Notifications » screen
// would show it. A mockup: every action plays out on screen, nothing is sent.
//
// One question per card — does this meeting go into Notion? — and two
// answers. Everything else is optional and one tap away on a person's row:
// filling in the contact before it is made, pointing at an existing one, or
// leaving that one person out.

type Decision =
  | { kind: "create"; enriched?: boolean }
  | { kind: "existing"; to: string }
  | { kind: "skip" };

type Row = Person & { decision: Decision | null; asked: boolean };

type Status = "open" | "adding" | "added" | "ignored";

// The delays of the add animation: Notion's answer (one request, a few
// seconds for real), then one row after another.
const WORK_MS = 1400;
const STEP_MS = 220;
const SETTLE_MS = 700;

const initialRows = (meeting: Meeting): Row[] =>
  [...meeting.people]
    // The ones the decision is about come first.
    .sort((a, b) => Number(a.known) - Number(b.known))
    .map((person) => ({
      ...person,
      decision: person.known
        ? null
        : person.candidate
          ? null
          : { kind: "create" },
      asked: !person.candidate,
    }));

export function MeetingCard({ meeting }: { meeting: Meeting }) {
  const [rows, setRows] = useState(() => initialRows(meeting));
  const [status, setStatus] = useState<Status>("open");
  const [summary, setSummary] = useState(false);
  // Rows already turned to ✓ by the add animation.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [refusing, setRefusing] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const update = (email: string, decision: Decision | null, asked = true) =>
    setRows((list) =>
      list.map((row) =>
        row.email === email ? { ...row, decision, asked } : row,
      ),
    );

  const toCreate = rows.filter((row) => row.decision?.kind === "create");
  const unanswered = rows.some((row) => !row.known && !row.asked);
  const added = rows.filter(
    (row) => !row.known && row.decision?.kind !== "skip",
  );

  const add = () => {
    setStatus("adding");
    const later = (ms: number, fn: () => void) =>
      timers.current.push(window.setTimeout(fn, ms));
    added.forEach((row, index) =>
      later(WORK_MS + index * STEP_MS, () =>
        setDone((set) => new Set(set).add(row.email)),
      ),
    );
    later(WORK_MS + added.length * STEP_MS + SETTLE_MS, () =>
      setStatus("added"),
    );
  };

  const ignore = (forever: boolean) => {
    setRefusing(false);
    setExcluded(forever ? toCreate.map((row) => row.name) : []);
    setStatus("ignored");
  };

  const reset = () => {
    timers.current.forEach(window.clearTimeout);
    setRows(initialRows(meeting));
    setDone(new Set());
    setExcluded([]);
    setStatus("open");
  };

  if (meeting.failed) return <FailedCard meeting={meeting} />;

  const editingRow = rows.find((row) => row.email === editing) ?? null;
  const busy = status === "adding";

  return (
    <div>
      <div
        className={cn(
          "meeting-collapse",
          (status === "added" || status === "ignored") && "is-closed",
        )}
      >
        <div className="meeting-collapse-inner">
          <article className="rounded-2xl bg-white-smoke p-4">
            <h3 className="text-base font-medium leading-snug">
              {meeting.title}
            </h3>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {meeting.when} · {meeting.organizer}
              {meeting.noteExists && " · Note déjà dans Notion"}
            </p>

            <ul className="mt-3 overflow-hidden rounded-xl bg-white">
              {rows.map((row, index) => (
                <PersonRow
                  key={row.email}
                  row={row}
                  first={index === 0}
                  working={busy && added.includes(row) && !done.has(row.email)}
                  done={done.has(row.email)}
                  onOpen={busy ? undefined : () => setEditing(row.email)}
                  onAnswer={(yes) =>
                    yes
                      ? update(row.email, {
                          kind: "existing",
                          to: `${row.candidate!.name} (${row.candidate!.company})`,
                        })
                      : update(row.email, { kind: "create" })
                  }
                />
              ))}
            </ul>

            <TextButton
              onClick={() => setSummary((on) => !on)}
              className="-ml-3 mt-1 text-xs"
              aria-expanded={summary}
            >
              {summary ? "Masquer le résumé" : "Lire le résumé"}
            </TextButton>
            {summary && (
              <p className="text-xs leading-relaxed text-[color:var(--muted)]">
                {meeting.summary}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <PrimaryButton
                onClick={add}
                disabled={busy || unanswered}
                className="h-12 flex-1 whitespace-nowrap rounded-xl px-3"
              >
                {busy
                  ? "Ajout en cours…"
                  : meeting.noteExists
                    ? "Ajouter à la note"
                    : "Ajouter cette note"}
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
            {unanswered && (
              <p className="mt-2 text-center text-xs text-[color:var(--muted)]">
                Répondez d'abord à la question ci-dessus.
              </p>
            )}
          </article>
        </div>
      </div>

      <Outcome
        status={status}
        meeting={meeting}
        created={toCreate.length}
        excluded={excluded}
        onUndo={reset}
      />

      <Sheet
        open={refusing}
        onClose={() => setRefusing(false)}
        label="Ne pas ajouter"
      >
        <RefuseSheet
          meeting={meeting}
          people={toCreate}
          onIgnore={ignore}
          onCancel={() => setRefusing(false)}
        />
      </Sheet>

      <Sheet
        open={editingRow !== null}
        onClose={() => setEditing(null)}
        label="Personne"
      >
        {editingRow && (
          <PersonSheet
            key={editingRow.email}
            row={editingRow}
            onDecide={(decision) => {
              update(editingRow.email, decision);
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </Sheet>
    </div>
  );
}

// ---- A person -----------------------------------------------------------------

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
  onAnswer: (yes: boolean) => void;
}) {
  const skipped = row.decision?.kind === "skip";
  const linked = row.decision?.kind === "existing";
  const icon = skipped
    ? "minus.circle"
    : row.known || linked || done
      ? "checkmark.circle"
      : "xmark.circle";
  const note = done
    ? linked
      ? `Adresse ajoutée à ${row.decision!.kind === "existing" ? row.decision!.to : ""}`
      : "Créé dans Notion"
    : skipped
      ? "Ne sera pas ajouté au CRM"
      : linked
        ? `Rattaché à ${row.decision!.kind === "existing" ? row.decision!.to : ""}`
        : row.decision?.kind === "create" && row.decision.enriched
          ? "Fiche complétée"
          : null;
  const tappable = !row.known && onOpen;

  const line = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className={cn("person-icon flex shrink-0", done && "is-flipped")}>
        <Icon
          name={icon}
          className={cn(
            "h-[18px]",
            icon === "checkmark.circle"
              ? "text-navy"
              : icon === "minus.circle"
                ? "text-[color:var(--muted)]"
                : "text-midnight-blue",
          )}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span
            className={cn(
              "font-medium",
              skipped && "text-[color:var(--muted)] line-through",
            )}
          >
            {row.name}
          </span>
          <span className="text-xs text-[color:var(--muted)]">
            , {row.email}
          </span>
        </span>
        {note && (
          <span className="block text-xs text-[color:var(--muted)]">
            {note}
          </span>
        )}
      </span>
      {tappable && (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-[color:var(--muted)]"
          fill="currentColor"
        >
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      )}
    </span>
  );

  return (
    <li
      className={cn(
        !first && "border-t border-[color:var(--hairline)]",
        working && "person-working",
      )}
    >
      {tappable ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-h-11 w-full items-center px-3 py-2 text-left"
        >
          {line}
        </button>
      ) : (
        <div className="flex min-h-11 items-center px-3 py-2">{line}</div>
      )}
      {!row.asked && row.candidate && (
        <div className="-mt-1 px-3 pb-3 pl-[38px]">
          <p className="text-xs leading-snug">
            Déjà dans Notion sous{" "}
            <span className="font-medium">{row.candidate.name}</span> ·{" "}
            {row.candidate.company} ?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="h-8 rounded-full bg-navy px-3.5 text-xs font-medium text-on-accent"
            >
              Oui, c'est la même personne
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="h-8 rounded-full bg-white-smoke px-3.5 text-xs font-medium text-navy"
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
  meeting,
  created,
  excluded,
  onUndo,
}: {
  status: Status;
  meeting: Meeting;
  created: number;
  excluded: string[];
  onUndo: () => void;
}) {
  const shown = status === "added" || status === "ignored";
  return (
    <div className={cn("meeting-collapse", !shown && "is-closed")}>
      <div className="meeting-collapse-inner">
        <div className="flex min-h-14 items-center gap-3 rounded-2xl bg-white-smoke px-4 py-2">
          <Icon
            name={status === "added" ? "checkmark.circle" : "minus.circle"}
            className="h-5 text-navy"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {status === "added"
                ? "Note ajoutée dans Notion"
                : "Réunion ignorée"}
            </span>
            <span className="block truncate text-xs text-[color:var(--muted)]">
              {status === "added"
                ? created
                  ? `${meeting.title} · ${created} contact${created > 1 ? "s" : ""} créé${created > 1 ? "s" : ""}`
                  : meeting.title
                : excluded.length
                  ? `Ne sera plus proposé : ${excluded.join(", ")}`
                  : "Rien n'a été écrit dans Notion"}
            </span>
          </span>
          {status === "added" ? (
            <a
              href="#"
              onClick={(event) => event.preventDefault()}
              className="shrink-0 text-xs text-navy"
            >
              Ouvrir ↗
            </a>
          ) : (
            <TextButton onClick={onUndo} className="-mr-3 shrink-0 text-xs">
              Annuler
            </TextButton>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- « Ne pas ajouter » ---------------------------------------------------------

function RefuseSheet({
  meeting,
  people,
  onIgnore,
  onCancel,
}: {
  meeting: Meeting;
  people: Row[];
  onIgnore: (forever: boolean) => void;
  onCancel: () => void;
}) {
  const names =
    people.length === 1
      ? people[0].name
      : people.length === 2
        ? `${people[0].name} et ${people[1].name}`
        : `ces ${people.length} personnes`;
  return (
    <div>
      <h2 className="font-serif text-2xl">
        {meeting.noteExists
          ? "Ne pas les ajouter ?"
          : "Ne pas ajouter cette note ?"}
      </h2>
      <p className="mt-2 text-[color:var(--muted)]">
        {meeting.noteExists
          ? "La note reste comme elle est, sans ces personnes."
          : "Rien ne sera écrit dans Notion."}
      </p>
      <PrimaryButton onClick={() => onIgnore(false)} className="mt-6">
        {meeting.noteExists
          ? "Laisser la note telle quelle"
          : "Ignorer cette réunion"}
      </PrimaryButton>
      {people.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onIgnore(true)}
            className="mt-2 flex min-h-14 w-full items-center justify-center rounded-2xl bg-white-smoke px-4 py-3 text-center font-medium text-navy"
          >
            Et ne plus proposer {names}
          </button>
          <p className="mt-2 px-2 text-center text-xs text-[color:var(--muted)]">
            Pour toute l'équipe. Réversible dans Réglages › Contacts exclus.
          </p>
        </>
      )}
      <div className="mt-2 flex justify-center">
        <TextButton onClick={onCancel}>Annuler</TextButton>
      </div>
    </div>
  );
}

// ---- A person's options: one sheet, three pages side by side ---------------------

function PersonSheet({
  row,
  onDecide,
  onClose,
}: {
  row: Row;
  onDecide: (decision: Decision) => void;
  onClose: () => void;
}) {
  const [page, setPage] = useState<"menu" | "form" | "picker">("menu");
  const content =
    page === "form" ? (
      <ContactForm
        row={row}
        onBack={() => setPage("menu")}
        onSave={() => onDecide({ kind: "create", enriched: true })}
      />
    ) : page === "picker" ? (
      <Picker
        onBack={() => setPage("menu")}
        onPick={(to) => onDecide({ kind: "existing", to })}
      />
    ) : (
      <Menu row={row} onPage={setPage} onDecide={onDecide} onClose={onClose} />
    );
  return (
    <SheetPages id={page} depth={page === "menu" ? 0 : 1}>
      {content}
    </SheetPages>
  );
}

function Option({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl bg-white-smoke p-4 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-[color:var(--muted)]">
          {detail}
        </span>
      </span>
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-[color:var(--muted)]"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function Menu({
  row,
  onPage,
  onDecide,
  onClose,
}: {
  row: Row;
  onPage: (page: "form" | "picker") => void;
  onDecide: (decision: Decision) => void;
  onClose: () => void;
}) {
  const kind = row.decision?.kind;
  return (
    <div>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-serif text-2xl">{row.name}</h2>
          <p className="truncate text-xs text-[color:var(--muted)]">
            {row.email}
          </p>
        </div>
        <TextButton onClick={onClose} className="-mr-3 shrink-0">
          OK
        </TextButton>
      </header>
      <div className="flex flex-col gap-2">
        {kind !== "create" && (
          <Option
            title="Créer le contact"
            detail="Avec son nom, son adresse et la société devinée."
            onClick={() => onDecide({ kind: "create" })}
          />
        )}
        <Option
          title="Compléter la fiche"
          detail="Société, téléphone, type… avant de l'ajouter."
          onClick={() => onPage("form")}
        />
        <Option
          title="C'est un contact existant"
          detail="Son adresse est ajoutée à sa fiche, rien n'est créé."
          onClick={() => onPage("picker")}
        />
        {kind !== "skip" && (
          <Option
            title="Ne pas l'ajouter au CRM"
            detail="La note est ajoutée sans cette personne."
            onClick={() => onDecide({ kind: "skip" })}
          />
        )}
      </div>
    </div>
  );
}

const field =
  "h-12 w-full rounded-2xl bg-white-smoke px-4 text-base text-midnight-blue outline-none placeholder:text-[color:var(--muted)]";

function Back({ onBack }: { onBack: () => void }) {
  return (
    <TextButton onClick={onBack} className="-ml-3 flex items-center gap-1">
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Retour
    </TextButton>
  );
}

function ContactForm({
  row,
  onBack,
  onSave,
}: {
  row: Row;
  onBack: () => void;
  onSave: () => void;
}) {
  const [first, ...last] = row.name.split(" ");
  return (
    <div>
      <Back onBack={onBack} />
      <h2 className="mt-1 font-serif text-2xl">Compléter la fiche</h2>
      <div className="mt-4 flex flex-col gap-2">
        <div className="flex gap-2">
          <input className={field} defaultValue={first} placeholder="Prénom" />
          <input
            className={field}
            defaultValue={last.join(" ")}
            placeholder="Nom"
          />
        </div>
        <input className={field} defaultValue={row.email} placeholder="Email" />
        <input
          className={field}
          defaultValue={row.company ?? ""}
          placeholder="Société"
        />
        {row.company && (
          <p className="-mt-1 px-2 text-xs text-[color:var(--muted)]">
            Société devinée d'après l'adresse.
          </p>
        )}
        <input className={field} placeholder="Téléphone" inputMode="tel" />
        <select className={field} defaultValue="">
          <option value="" disabled>
            Type
          </option>
          {TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </div>
      <PrimaryButton onClick={onSave} className="mt-4">
        Enregistrer
      </PrimaryButton>
      <p className="mt-2 text-center text-xs text-[color:var(--muted)]">
        Le contact est créé quand la note est ajoutée.
      </p>
    </div>
  );
}

function Picker({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (to: string) => void;
}) {
  const [query, setQuery] = useState("");
  const fold = (text: string) =>
    text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const shown = CONTACTS.filter((contact) =>
    fold(`${contact.name} ${contact.company}`).includes(fold(query)),
  );
  return (
    <div>
      <Back onBack={onBack} />
      <h2 className="mt-1 font-serif text-2xl">Quel contact ?</h2>
      <input
        className={cn(field, "mt-4")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Nom ou société"
      />
      <ul className="mt-2 flex flex-col gap-2">
        {shown.map((contact) => (
          <li key={contact.name}>
            <button
              type="button"
              onClick={() => onPick(`${contact.name} (${contact.company})`)}
              className="flex min-h-14 w-full flex-col justify-center rounded-2xl bg-white-smoke px-4 py-2 text-left"
            >
              <span className="font-medium">{contact.name}</span>
              <span className="text-xs text-[color:var(--muted)]">
                {contact.company}
              </span>
            </button>
          </li>
        ))}
        {!shown.length && (
          <p className="px-2 text-[color:var(--muted)]">
            Aucun contact ne correspond.
          </p>
        )}
      </ul>
    </div>
  );
}

// ---- A report that could not be processed ----------------------------------------

function FailedCard({ meeting }: { meeting: Meeting }) {
  const [state, setState] = useState<"failed" | "retrying" | "gone">("failed");
  return (
    <div className={cn("meeting-collapse", state === "gone" && "is-closed")}>
      <div className="meeting-collapse-inner">
        <article className="rounded-2xl bg-white-smoke p-4">
          <h3 className="text-base font-medium leading-snug">
            {meeting.title}
          </h3>
          <p className="mt-0.5 text-xs text-[color:var(--muted)]">
            {meeting.when} · {meeting.organizer}
          </p>
          <p className="mt-3 rounded-xl bg-white px-3 py-2.5 text-xs leading-snug">
            <span className="font-medium">Réunion non enregistrée.</span>{" "}
            {meeting.failed}
          </p>
          <div className="mt-3 flex gap-2">
            <PrimaryButton
              onClick={() => {
                setState("retrying");
                window.setTimeout(() => setState("gone"), 1400);
              }}
              disabled={state !== "failed"}
              className="h-12 flex-1 whitespace-nowrap rounded-xl px-3"
            >
              {state === "retrying" ? "Nouvel essai…" : "Réessayer"}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setState("gone")}
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
