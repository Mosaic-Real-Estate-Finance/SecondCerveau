import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContactsState } from "@/App";
import { NotificationsCta } from "@/components/notifications-cta";
import { Screen, TextButton, TopBar } from "@/components/screen";
import { SheetPages } from "@/components/sheet";
import { SlidingTabs, type Tab } from "@/components/sliding-tabs";
import { StackBanner } from "@/components/stack-banner";
import { useToast } from "@/components/toast";
import { ApiError, fetchReview, type ReviewItem } from "@/lib/api";
import { useNotes, type Note } from "@/lib/notes";
import { listOf, MeetingCard } from "@/screens/notifications/MeetingCard";
import { NoteCard } from "@/screens/notifications/NoteCard";

// « Notifications »: everything waiting on the user, in one place — the
// dictations not yet in Notion, and the Read AI meetings with someone the CRM
// does not know. Three views over the same two lists, switched by sliding
// tabs; the content slides the way the pill does.

type View = "all" | "notes" | "meetings";

const ORDER: View[] = ["all", "notes", "meetings"];

// How long the « contacts exclus » banner stays at the bottom of the screen.
const BANNER_MS = 6000;

type Entry = { kind: "note"; at: number; note: Note } | { kind: "meeting"; at: number; item: ReviewItem };

export function NotificationsScreen({
  active,
  contacts,
  focusId,
  onBack,
  onCount,
  onOpenNote,
  onOpenExcluded,
  onUnauthorized,
  notes: shownNotes,
  onDeleteNote,
}: {
  active: boolean;
  contacts: ContactsState;
  /** Opened from a notification: the meeting to bring into view. */
  focusId: string | null;
  onBack: () => void;
  /** Meetings still waiting, for the bell on the home screen. */
  onCount: (count: number) => void;
  onOpenNote: (note: Note) => void;
  /** Réglages › Contacts exclus, from the banner. */
  onOpenExcluded: () => void;
  onUnauthorized: () => void;
  /** The mockup's own notes, kept away from the phone's store (same origin). */
  notes?: Note[];
  onDeleteNote?: (id: string) => unknown;
}) {
  const toast = useToast();
  const stored = useNotes();
  const notes = shownNotes ?? stored;
  const [view, setView] = useState<View>("all");
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  // Decided here: the card stays for its outcome, the count goes down at once.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [excluded, setExcluded] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const data = await fetchReview();
      setItems(data.items);
      setClosed(new Set());
      setStatus("ready");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return onUnauthorized();
      setError((cause as Error).message);
      setStatus("error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  // Brought into view once it is drawn.
  useEffect(() => {
    if (!active || !focusId || status !== "ready") return;
    document.getElementById(`review-${focusId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [active, focusId, status]);

  const waiting = items.filter((item) => !closed.has(item.id)).length;
  useEffect(() => {
    if (status === "ready") onCount(waiting);
  }, [status, waiting, onCount]);

  useEffect(() => {
    if (!excluded) return;
    const timer = window.setTimeout(() => setExcluded(null), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [excluded]);

  const replace = (item: ReviewItem) => setItems((list) => list.map((one) => (one.id === item.id ? item : one)));
  const close = (id: string) => setClosed((set) => new Set(set).add(id));

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
    toast.show((cause as Error).message || "Une erreur est survenue.");
  };

  const entries = useMemo<Entry[]>(
    () =>
      [
        ...notes.map<Entry>((note) => ({ kind: "note", at: note.createdAt, note })),
        ...items.map<Entry>((item) => ({ kind: "meeting", at: Date.parse(item.meeting.start) || 0, item })),
      ].sort((a, b) => b.at - a.at),
    [notes, items],
  );
  const shown = entries.filter((entry) =>
    view === "all" ? true : view === "notes" ? entry.kind === "note" : entry.kind === "meeting",
  );

  const tabs: Tab<View>[] = [
    { id: "all", label: "Tout", count: notes.length + waiting },
    { id: "notes", label: "Notes à envoyer", count: notes.length },
    { id: "meetings", label: "Réunions Read AI à valider", count: waiting },
  ];

  const renderEntry = (entry: Entry) =>
    entry.kind === "note" ? (
      <li key={`note-${entry.note.id}`}>
        <NoteCard note={entry.note} onOpen={onOpenNote} onDelete={onDeleteNote} />
      </li>
    ) : (
      <li key={entry.item.id} id={`review-${entry.item.id}`} className="scroll-mt-4">
        <MeetingCard
          item={entry.item}
          contacts={contacts}
          focused={entry.item.id === focusId}
          onClosed={close}
          onReplace={replace}
          onFailed={failed}
          onReload={() => void load()}
          onExcluded={setExcluded}
        />
      </li>
    );

  const meetingsMissing = view !== "notes" && status !== "ready";

  return (
    <Screen>
      <TopBar title="Notifications" onBack={onBack} backLabel="Accueil" />
      <p className="-mt-3 mb-4 text-xs text-[color:var(--muted)]">
        Les notes pas encore envoyées et les réunions Read AI à valider. Rien n'est écrit dans Notion avant votre
        décision.
      </p>
      <NotificationsCta />

      <SlidingTabs tabs={tabs} value={view} onChange={setView} label="Afficher" className="mb-5" />

      <div id={`panel-${view}`} role="tabpanel" aria-labelledby={`tab-${view}`}>
        <SheetPages id={view} depth={ORDER.indexOf(view)}>
          <div>
            {meetingsMissing && status === "loading" && (
              <p className="mb-3 text-[color:var(--muted)]">Chargement des réunions…</p>
            )}
            {meetingsMissing && status === "error" && (
              <div className="mb-3 rounded-2xl bg-white-smoke p-4">
                <p className="font-medium">Réunions indisponibles</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">{error}</p>
                <TextButton onClick={() => void load()} className="-ml-3 mt-1">
                  Réessayer
                </TextButton>
              </div>
            )}
            {shown.length > 0 ? (
              <ul className="flex flex-col gap-3">{shown.map(renderEntry)}</ul>
            ) : (
              (view === "notes" || status === "ready") && <Empty view={view} />
            )}
          </div>
        </SheetPages>
      </div>

      <StackBanner visible={active && excluded !== null} label="Contacts exclus">
        <button
          type="button"
          onClick={() => {
            setExcluded(null);
            onOpenExcluded();
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{listOf(excluded ?? [""])} dans les contacts exclus</span>
            <span className="mt-0.5 block text-xs text-[color:var(--muted)]">
              Pour toute l'équipe. Réversible dans Réglages › Contacts exclus.
            </span>
          </span>
          <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--muted)]">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </StackBanner>
    </Screen>
  );
}

function Empty({ view }: { view: View }) {
  const text =
    view === "notes"
      ? "Aucune note à envoyer. Une dictée qui n'est pas encore dans Notion apparaît ici."
      : view === "meetings"
        ? "Aucune réunion à valider. Une réunion Read AI avec une personne que le CRM ne connaît pas apparaît ici."
        : "Rien en attente. Les notes pas encore envoyées et les réunions Read AI à valider apparaissent ici.";
  return <p className="rounded-2xl bg-white-smoke p-4 text-[color:var(--muted)]">{text}</p>;
}
