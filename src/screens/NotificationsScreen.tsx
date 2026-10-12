import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContactsState } from "@/App";
import { NotificationsCta } from "@/components/notifications-cta";
import { TextButton, TopBar } from "@/components/screen";
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
//
// Only the list scrolls. The title and the tabs stay put above it, on frosted
// glass, and the cards slide under them.

type View = "all" | "notes" | "meetings";

const ORDER: View[] = ["all", "notes", "meetings"];

// How long the « contacts exclus » banner stays at the bottom of the screen.
const BANNER_MS = 6000;

type Entry =
  | { kind: "note"; at: number; note: Note }
  | { kind: "meeting"; at: number; item: ReviewItem };

export function NotificationsScreen({
  active,
  contacts,
  focusId,
  focusKey = 0,
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
  /**
   * Opened from a notification: the meeting to bring into view ("" for none
   * in particular). `focusKey` changes with every tap, so the same
   * notification tapped twice still scrolls.
   */
  focusId: string | null;
  focusKey?: number;
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
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
      if (cause instanceof ApiError && cause.status === 401)
        return onUnauthorized();
      setError((cause as Error).message);
      setStatus("error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLElement>(null);

  const show = (next: View) => {
    setView(next);
    // Each view starts at its top.
    scroller.current?.scrollTo({ top: 0 });
  };

  // From a notification: the meeting, in a view that shows it, brought just
  // under the tabs once it is drawn. Gone in the meantime (a colleague
  // decided, or it was ignored): said so, rather than a screen that seems to
  // ignore the tap.
  const focused = useRef<number | null>(null);
  useEffect(() => {
    if (
      !active ||
      focusId === null ||
      status !== "ready" ||
      focused.current === focusKey
    )
      return;
    focused.current = focusKey;
    if (!focusId) return show("all");
    if (!items.some((item) => item.id === focusId)) {
      show("all");
      return void toast.show("Cette réunion a déjà été traitée.");
    }
    setView((current) => (current === "notes" ? "all" : current));
    // Two frames: the view swapped in, then laid out.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const box = scroller.current;
        const card = document.getElementById(`review-${focusId}`);
        if (!box || !card) return;
        const top =
          card.getBoundingClientRect().top -
          box.getBoundingClientRect().top +
          box.scrollTop -
          (head.current?.offsetHeight ?? 0) -
          12;
        box.scrollTo({ top, behavior: "smooth" });
      }),
    );
    // `show` and `toast` are stable enough; the tap is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, focusId, focusKey, status, items]);

  const waiting = items.filter((item) => !closed.has(item.id)).length;
  useEffect(() => {
    if (status === "ready") onCount(waiting);
  }, [status, waiting, onCount]);

  useEffect(() => {
    if (!excluded) return;
    const timer = window.setTimeout(() => setExcluded(null), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [excluded]);

  const replace = (item: ReviewItem) =>
    setItems((list) => list.map((one) => (one.id === item.id ? item : one)));
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
        ...notes.map<Entry>((note) => ({
          kind: "note",
          at: note.createdAt,
          note,
        })),
        ...items.map<Entry>((item) => ({
          kind: "meeting",
          at: Date.parse(item.meeting.start) || 0,
          item,
        })),
      ].sort((a, b) => b.at - a.at),
    [notes, items],
  );
  const shown = entries.filter((entry) =>
    view === "all"
      ? true
      : view === "notes"
        ? entry.kind === "note"
        : entry.kind === "meeting",
  );

  const tabs: Tab<View>[] = [
    { id: "all", label: "Tout", count: notes.length + waiting },
    {
      id: "notes",
      label: "Dictées à envoyer",
      short: "Dictées",
      count: notes.length,
    },
    {
      id: "meetings",
      label: "Réunions à valider",
      short: "ReadAI",
      count: waiting,
    },
  ];

  const renderEntry = (entry: Entry) =>
    entry.kind === "note" ? (
      <li key={`note-${entry.note.id}`}>
        <NoteCard
          note={entry.note}
          onOpen={onOpenNote}
          onDelete={onDeleteNote}
        />
      </li>
    ) : (
      <li key={entry.item.id} id={`review-${entry.item.id}`}>
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
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <header
          ref={head}
          className="notifications-head sticky top-0 z-10 px-4 pb-3"
          style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}
        >
          <TopBar title="Notifications" onBack={onBack} backLabel="Accueil" />
          <div className="-mt-3">
            <SlidingTabs
              tabs={tabs}
              value={view}
              onChange={show}
              label="Afficher"
            />
          </div>
        </header>

        {/* Room under the last card for the home indicator, Safari's bar and
            the banner that can rise over it: the last card is read whole. */}
        <div
          className="px-4 pt-3"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 120px)" }}
        >
          <NotificationsCta />

          <div
            id={`panel-${view}`}
            role="tabpanel"
            aria-labelledby={`tab-${view}`}
          >
            <SheetPages id={view} depth={ORDER.indexOf(view)}>
              <div>
                {meetingsMissing && status === "loading" && (
                  <p className="mb-3 text-[color:var(--muted)]">
                    Chargement des réunions…
                  </p>
                )}
                {meetingsMissing && status === "error" && (
                  <div className="mb-3 rounded-2xl bg-white-smoke p-4">
                    <p className="font-medium">Réunions indisponibles</p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                      {error}
                    </p>
                    <TextButton
                      onClick={() => void load()}
                      className="-ml-3 mt-1"
                    >
                      Réessayer
                    </TextButton>
                  </div>
                )}
                {shown.length > 0 ? (
                  <ul className="flex flex-col gap-3">
                    {shown.map(renderEntry)}
                  </ul>
                ) : (
                  (view === "notes" || status === "ready") && (
                    <Empty view={view} />
                  )
                )}
              </div>
            </SheetPages>
          </div>
        </div>
      </div>

      <StackBanner
        visible={active && excluded !== null}
        label="Contacts exclus"
      >
        <button
          type="button"
          onClick={() => {
            setExcluded(null);
            onOpenExcluded();
          }}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">
              {listOf(excluded ?? [""])} dans les contacts exclus
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
    </div>
  );
}

function Empty({ view }: { view: View }) {
  const text =
    view === "notes"
      ? "Aucune dictée à envoyer. Une dictée qui n'est pas encore dans Notion apparaît ici."
      : view === "meetings"
        ? "Aucune réunion à valider. Une réunion Read AI avec une personne que le CRM ne connaît pas apparaît ici."
        : "Rien en attente. Les dictées pas encore envoyées et les réunions Read AI à valider apparaissent ici.";
  return (
    <p className="rounded-2xl bg-white-smoke p-4 text-[color:var(--muted)]">
      {text}
    </p>
  );
}
