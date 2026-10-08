import { useCallback, useEffect, useRef, useState } from "react";
import { AccessGate } from "@/screens/AccessGate";
import { ContactScreen } from "@/screens/ContactScreen";
import { RecordScreen } from "@/screens/RecordScreen";
import { AttachScreen } from "@/screens/AttachScreen";
import { ReviewScreen } from "@/screens/ReviewScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { InstallInvite } from "@/components/install-invite";
import { ToastProvider } from "@/components/toast";
import { ApiError, fetchContacts, fetchReviewCount, fetchSession, session, type Contact, type Session } from "@/lib/api";
import { persistStorage, updateNote, type Note, type NoteContact } from "@/lib/notes";
import { resumePending, transcribeNote } from "@/lib/pipeline";
import { afterTransition } from "@/lib/schedule";
import { checkModelCached, preloadModel } from "@/lib/transcriber";

export type ContactsState = {
  status: "loading" | "ready" | "error";
  contacts: Contact[];
  // The Type options of the base, for the contact creation form.
  typeOptions: string[];
  error?: string;
};

type Page = 1 | 2 | 3 | 4;

// A notification opens /?valider=<id>: the « À valider » screen, on that call.
function linkedReview(): string | null {
  const id = new URLSearchParams(window.location.search).get("valider");
  if (id !== null) window.history.replaceState(null, "", window.location.pathname);
  return id;
}

export default function App() {
  const [user, setUser] = useState<Session | null>(session.get());
  const [focusId, setFocusId] = useState<string | null>(linkedReview);
  const [page, setPage] = useState<Page>(focusId !== null ? 4 : 1);
  const [reviewCount, setReviewCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const [contacts, setContacts] = useState<ContactsState>({ status: "loading", contacts: [], typeOptions: [] });

  useEffect(() => {
    void persistStorage();
    // The model downloads in the background from the first launch: streamed to
    // the cache, never loaded into memory until a transcription needs it.
    void checkModelCached().then(preloadModel);
    void resumePending();
  }, []);

  const signOut = useCallback(() => {
    session.clear();
    setUser(null);
    setPage(1);
    setSettingsOpen(false);
  }, []);

  // The session lives in an HttpOnly cookie this code cannot see. It is read
  // back at every launch — which also extends it for 90 days — and an app
  // installed before the sign-in by code meets the access screen once.
  useEffect(() => {
    if (!user) return;
    fetchSession()
      .then((current) => {
        session.set(current);
        if (current.firstName !== user.firstName) setUser(current);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) signOut();
      });
    // Once per sign-in, not on every change of the greeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, signOut]);

  // The count on the home screen, read when the app comes back to the front.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      fetchReviewCount()
        .then(({ count }) => setReviewCount(count))
        .catch(() => undefined);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [user]);

  // A notification clicked while the app is already open: the service worker
  // sends the address instead of opening a second window.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const url = typeof event.data?.open === "string" ? new URL(event.data.open, location.origin) : null;
      const id = url?.searchParams.get("valider");
      if (id === null || id === undefined) return;
      setFocusId(id);
      setSettingsOpen(false);
      setPage(4);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const loadContacts = useCallback(async () => {
    setContacts((previous) => ({ ...previous, status: "loading" }));
    try {
      const { contacts = [], typeOptions = [] } = await fetchContacts();
      setContacts({ status: "ready", contacts, typeOptions });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return signOut();
      setContacts((previous) => ({ ...previous, status: "error", error: (error as Error).message }));
    }
  }, [signOut]);

  useEffect(() => {
    if (user) void loadContacts();
  }, [user, loadContacts]);

  // A contact created from the list joins it without a round trip.
  const addContact = useCallback((contact: Contact) => {
    setContacts((previous) => ({ ...previous, contacts: [contact, ...previous.contacts] }));
  }, []);

  // Stable: the contact list memoises its rows on this identity.
  const pick = useCallback(
    async (contact: NoteContact) => {
      if (!noteIdRef.current) return;
      await updateNote(noteIdRef.current, { contact });
      setPage(3);
    },
    [],
  );

  if (!user) {
    return (
      <AccessGate
        onValid={(next) => {
          session.set(next);
          setUser(next);
        }}
      />
    );
  }

  const openNote = (note: Note) => {
    setNoteId(note.id);
    setPage(note.contact === undefined ? 2 : 3);
    if (contacts.status === "error") void loadContacts();
  };

  const recorded = (note: Note) => {
    openNote(note);
    // Decoding the audio and waking the Whisper worker cost tens of
    // milliseconds of main thread each: started here they would land on the
    // frames of the page slide. They wait for it to be over.
    afterTransition(() => void transcribeNote(note.id));
  };

  const done = () => {
    setPage(1);
    setNoteId(null);
  };

  return (
    <ToastProvider>
      {/* Only once signed in: the invitation is worth nothing before. */}
      <InstallInvite />
      <div className="t-page-slide mx-auto h-full max-w-[480px]" data-page={page}>
        <section className="t-page" data-page-id="1" inert={page !== 1 || settingsOpen}>
          <RecordScreen
            active={page === 1 && !settingsOpen}
            firstName={user.firstName}
            reviewCount={reviewCount}
            onRecorded={recorded}
            onOpen={openNote}
            onReview={() => setPage(4)}
            onSettings={() => setSettingsOpen(true)}
          />
        </section>
        <section className="t-page" data-page-id="2" inert={page !== 2}>
          <ContactScreen
            active={page === 2}
            contacts={contacts}
            onReload={loadContacts}
            onCreated={addContact}
            onBack={done}
            onPick={pick}
          />
        </section>
        <section className="t-page" data-page-id="3" inert={page !== 3}>
          <AttachScreen
            active={page === 3}
            noteId={noteId}
            onChangeContact={() => setPage(2)}
            onBack={done}
            onDone={done}
            onUnauthorized={signOut}
          />
        </section>
        <section className="t-page" data-page-id="4" inert={page !== 4}>
          <ReviewScreen
            active={page === 4}
            contacts={contacts}
            focusId={focusId}
            onBack={() => {
              setFocusId(null);
              setPage(1);
            }}
            onCount={setReviewCount}
            onContactCreated={addContact}
            onUnauthorized={signOut}
          />
        </section>
      </div>
      {/* Panel reveal: the settings rise over the home screen rather than
          sliding in as a page. */}
      <div className="settings-sheet t-panel-slide" data-open={settingsOpen} inert={!settingsOpen}>
        <SettingsScreen
          active={settingsOpen}
          email={user.email}
          onBack={() => setSettingsOpen(false)}
          onSignedOut={signOut}
        />
      </div>
    </ToastProvider>
  );
}
