import { useCallback, useEffect, useRef, useState } from "react";
import { AccessGate } from "@/screens/AccessGate";
import { ContactScreen } from "@/screens/ContactScreen";
import { RecordScreen } from "@/screens/RecordScreen";
import { AttachScreen } from "@/screens/AttachScreen";
import { InstallInvite } from "@/components/install-invite";
import { ToastProvider } from "@/components/toast";
import { ApiError, fetchContacts, session, type Contact, type Session } from "@/lib/api";
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

type Page = 1 | 2 | 3;

export default function App() {
  const [user, setUser] = useState<Session | null>(session.get());
  const [page, setPage] = useState<Page>(1);
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
        <section className="t-page" data-page-id="1" inert={page !== 1}>
          <RecordScreen active={page === 1} firstName={user.firstName} onRecorded={recorded} onOpen={openNote} />
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
      </div>
    </ToastProvider>
  );
}
