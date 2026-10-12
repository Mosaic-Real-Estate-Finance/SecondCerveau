import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icon";
import { PrimaryButton, TextButton } from "@/components/screen";
import { CountryPicker } from "@/components/country-picker";
import { PhoneNumberInput } from "@/components/phone-input";
import { SearchField } from "@/components/search-field";
import { Sheet, SheetPages } from "@/components/sheet";
import { StackBanner } from "@/components/stack-banner";
import { cn } from "@/lib/utils";
import { CONTACTS, TYPES, type Meeting, type Person } from "./data";
import { formatWhen } from "./when";

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
// How long the « contacts exclus » banner stays at the bottom of the screen.
const BANNER_MS = 6000;

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
  // The « Contacts exclus » setting, opened from the banner.
  const [settings, setSettings] = useState(false);
  const [banner, setBanner] = useState(false);
  // « Ajouter » pressed with a « same person? » left open: asked again here.
  const [confirming, setConfirming] = useState(false);
  // Rows already turned to ✓ by the add animation.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [refusing, setRefusing] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(false), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const update = (email: string, decision: Decision | null, asked = true) =>
    setRows((list) =>
      list.map((row) =>
        row.email === email ? { ...row, decision, asked } : row,
      ),
    );

  const toCreate = rows.filter((row) => row.decision?.kind === "create");
  const unanswered = rows.filter((row) => !row.known && !row.asked);
  const writes = (list: Row[]) =>
    list.filter((row) => !row.known && row.decision?.kind !== "skip");
  const added = writes(rows);

  const add = (list = rows) => {
    const added = writes(list);
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
    setBanner(forever && toCreate.length > 0);
  };

  const reset = () => {
    timers.current.forEach(window.clearTimeout);
    setRows(initialRows(meeting));
    setDone(new Set());
    setExcluded([]);
    setBanner(false);
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
            <header className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold leading-snug">
                  {meeting.title}
                </h3>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                  {formatWhen(meeting.at)} · {meeting.organizer}
                  {meeting.noteExists && " · Note déjà dans Notion"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSummary(true)}
                aria-label="Lire le résumé"
                title="Lire le résumé"
                className="-mr-2 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy"
              >
                <Icon name="quote.bubble" className="h-[18px]" />
              </button>
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
                  working={busy && added.includes(row) && !done.has(row.email)}
                  done={done.has(row.email)}
                  onOpen={busy ? undefined : () => setEditing(row.email)}
                  onAnswer={(same) => update(row.email, answer(row, same))}
                />
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <PrimaryButton
                onClick={() =>
                  unanswered.length ? setConfirming(true) : add()
                }
                disabled={busy}
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
          </article>
        </div>
      </div>

      <Outcome
        status={status}
        meeting={meeting}
        created={toCreate.length}
        onUndo={reset}
      />

      <StackBanner visible={banner} label="Contacts exclus">
        <button
          type="button"
          onClick={() => {
            setBanner(false);
            setSettings(true);
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {listOf(excluded)} dans les contacts exclus
            </span>
            <span className="mt-0.5 block text-xs text-[color:var(--muted)]">
              Pour toute l'équipe. Réversible dans Réglages › Contacts exclus.
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
      </StackBanner>

      <Sheet open={summary} onClose={() => setSummary(false)} label="Résumé">
        <SummarySheet meeting={meeting} onClose={() => setSummary(false)} />
      </Sheet>

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        label="Même personne ?"
      >
        {confirming && unanswered.length > 0 && (
          <SamePersonSheet
            key={unanswered[0].email}
            row={unanswered[0]}
            left={unanswered.length}
            onAnswer={(same) => {
              const next = rows.map((row) =>
                row.email === unanswered[0].email
                  ? { ...row, asked: true, decision: answer(row, same) }
                  : row,
              );
              setRows(next);
              // The last one answered: the note goes in, as asked.
              if (unanswered.length === 1) {
                setConfirming(false);
                add(next);
              }
            }}
            onCancel={() => setConfirming(false)}
          />
        )}
      </Sheet>

      <Sheet
        open={settings}
        onClose={() => setSettings(false)}
        label="Contacts exclus"
      >
        <ExcludedSheet
          people={rows.filter((row) => excluded.includes(row.name))}
          onRemove={(name) => {
            const left = excluded.filter((other) => other !== name);
            setExcluded(left);
            // Nobody left on the list: the meeting is back to decide on.
            if (!left.length) {
              setSettings(false);
              reset();
            }
          }}
          onClose={() => setSettings(false)}
        />
      </Sheet>

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

/** The answer to « déjà dans Notion sous … ? », as a decision. */
const answer = (row: Row, same: boolean): Decision =>
  same
    ? {
        kind: "existing",
        to: `${row.candidate!.name} (${row.candidate!.company})`,
      }
    : { kind: "create" };

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
      ? "Ne rejoindra pas le CRM"
      : linked
        ? `Rattaché à ${row.decision!.kind === "existing" ? row.decision!.to : ""}`
        : row.decision?.kind === "create" && row.decision.enriched
          ? "Fiche complétée"
          : null;
  const tappable = !row.known && onOpen;
  const firstName = row.name.split(" ")[0];
  const tip = skipped
    ? `${firstName} ne rejoindra pas le CRM`
    : icon === "checkmark.circle"
      ? `${firstName} existe déjà dans Notion`
      : `${firstName} n'existe pas dans Notion`;

  const line = (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <span className="person-tip relative flex shrink-0" data-tip={tip}>
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
        <span className="sr-only">{tip}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <span
            className={cn(
              "text-[14px] font-medium",
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
        <Icon
          name="square.and.pencil"
          className="h-[17px] shrink-0 text-[color:var(--muted)]"
        />
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
          <div className="mt-1.5 flex gap-1.5">
            <button
              type="button"
              onClick={() => onAnswer(true)}
              className="h-6 rounded-full bg-white-smoke px-2.5 text-[11px] font-medium text-navy"
            >
              Oui, même personne
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="h-6 rounded-full bg-white-smoke px-2.5 text-[11px] font-medium text-navy"
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
  onUndo,
}: {
  status: Status;
  meeting: Meeting;
  created: number;
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
                : meeting.noteExists
                  ? "La note existante n'a pas été modifiée"
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
  const names = listOf(people.map((person) => person.name));
  return (
    <div>
      <h2 className="font-serif text-2xl">
        {meeting.noteExists
          ? `Ne pas ajouter ${names} ?`
          : "Ne pas ajouter cette note ?"}
      </h2>
      <p className="mt-2 text-[color:var(--muted)]">
        {meeting.noteExists
          ? `La note est déjà dans Notion, enregistrée par un collègue. Elle n'est ni modifiée ni supprimée : aucune fiche n'est créée pour ${names}.`
          : "Rien ne sera écrit dans Notion."}
      </p>
      <PrimaryButton onClick={() => onIgnore(false)} className="mt-6">
        Ignorer cette réunion
      </PrimaryButton>
      {people.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => onIgnore(true)}
            className="mt-2 flex min-h-14 w-full items-center justify-center rounded-2xl bg-white-smoke px-4 py-3 text-center font-medium text-navy"
          >
            Toujours ignorer {names}
          </button>
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

const OPTION_ICON_SIZE: Partial<Record<IconName, string>> = {
  "square.and.pencil": "h-[19px]",
  "person.line.dotted.person": "h-[15px]",
  "person.fill.xmark": "h-[15px]",
};

function Option({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: IconName;
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
      {/* Sized by eye, not by file: the pencil's export carries a margin,
          the person fills its own, the pair is twice as wide. Each height
          below draws its glyph about 16px tall, in one 36px column. */}
      <span className="flex w-9 shrink-0 justify-center text-navy">
        <Icon name={icon} className={OPTION_ICON_SIZE[icon]} />
      </span>
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
  const skipped = row.decision?.kind === "skip";
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
        <Option
          icon="square.and.pencil"
          title="Créer le contact"
          detail="Sa fiche, pré-remplie d'après son mail, à vérifier ou compléter."
          onClick={() => onPage("form")}
        />
        <Option
          icon="person.line.dotted.person"
          title="Associer à un contact existant"
          detail="Son adresse est ajoutée à sa fiche, rien n'est créé."
          onClick={() => onPage("picker")}
        />
        {!skipped && (
          <Option
            icon="person.fill.xmark"
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
  const [country, setCountry] = useState("FR");
  const [phone, setPhone] = useState("");
  return (
    <div>
      <Back onBack={onBack} />
      <h2 className="mt-1 font-serif text-2xl">Créer le contact</h2>
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
            Société suggérée d'après le mail.
          </p>
        )}
        <div className="flex gap-2">
          <CountryPicker
            value={country}
            onChange={setCountry}
            label="Indicatif"
          />
          <PhoneNumberInput
            country={country}
            value={phone}
            onChange={setPhone}
            label="Téléphone"
            className="flex-1"
          />
        </div>
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
      <div className="mt-4">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Nom ou société"
          label="Rechercher un contact"
        />
      </div>
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

/** « A », « A et B », « ces 3 personnes ». */
function listOf(names: string[]) {
  return names.length === 1
    ? names[0]
    : names.length === 2
      ? `${names[0]} et ${names[1]}`
      : `ces ${names.length} personnes`;
}

// ---- Read AI's summary --------------------------------------------------------------

function SummarySheet({
  meeting,
  onClose,
}: {
  meeting: Meeting;
  onClose: () => void;
}) {
  return (
    <div>
      {/* Stays put while a long summary scrolls under it, blurred away. */}
      <header className="summary-head sticky -top-1 z-10 -mx-4 flex items-start justify-between gap-3 px-4 pb-3 pt-1">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight">{meeting.title}</h2>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {formatWhen(meeting.at)} · {meeting.organizer}
          </p>
        </div>
        <TextButton onClick={onClose} className="-mr-3 shrink-0">
          OK
        </TextButton>
      </header>
      <div className="mt-1 flex flex-col gap-3 leading-relaxed">
        {meeting.summary.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}

// ---- « Ajouter » with a question left open ---------------------------------------------

function SamePersonSheet({
  row,
  left,
  onAnswer,
  onCancel,
}: {
  row: Row;
  left: number;
  onAnswer: (same: boolean) => void;
  onCancel: () => void;
}) {
  const candidate = row.candidate!;
  return (
    <div>
      <h2 className="font-serif text-2xl">Est-ce la même personne&nbsp;?</h2>
      <p className="mt-2 text-[color:var(--muted)]">
        Une fiche du même nom existe déjà dans Notion, sous une autre adresse
        que {row.email}.
      </p>
      <div className="mt-4 rounded-2xl bg-white-smoke px-4 py-3">
        <p className="font-medium">{candidate.name}</p>
        <p className="text-xs text-[color:var(--muted)]">
          {candidate.company} · déjà dans Notion
        </p>
      </div>
      <PrimaryButton onClick={() => onAnswer(true)} className="mt-6">
        Oui, l'associer à cette fiche
      </PrimaryButton>
      <button
        type="button"
        onClick={() => onAnswer(false)}
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

// ---- Réglages › Contacts exclus, as the banner opens it ------------------------------

function ExcludedSheet({
  people,
  onRemove,
  onClose,
}: {
  people: Row[];
  onRemove: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <header className="mb-2 flex items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">Contacts exclus</h2>
        <TextButton onClick={onClose} className="-mr-3 shrink-0">
          OK
        </TextButton>
      </header>
      <p className="mb-4 text-xs text-[color:var(--muted)]">
        Les personnes que vous avez refusé d'ajouter dans Notion ne vous sont
        plus proposées, ni à vos collègues. Retirez-en une pour qu'elle le soit
        à nouveau.
      </p>
      <ul className="flex flex-col gap-2">
        {people.map((person) => (
          <li
            key={person.email}
            className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white-smoke py-2 pl-4 pr-2"
          >
            <span className="min-w-0 truncate">{person.email}</span>
            <TextButton
              onClick={() => onRemove(person.name)}
              className="shrink-0"
            >
              Retirer
            </TextButton>
          </li>
        ))}
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
          <h3 className="text-base font-semibold leading-snug">
            {meeting.title}
          </h3>
          <p className="mt-0.5 text-xs text-[color:var(--muted)]">
            {formatWhen(meeting.at)} · {meeting.organizer}
          </p>
          <p className="mt-3 rounded-xl bg-white px-3 py-2.5 text-xs leading-snug">
            <span className="font-medium">Pas encore dans Notion.</span>{" "}
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
