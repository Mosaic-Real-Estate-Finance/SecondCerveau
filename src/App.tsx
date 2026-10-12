import { useCallback, useEffect, useRef, useState } from "react";
import { AccessGate } from "@/screens/AccessGate";
import { ContactScreen } from "@/screens/ContactScreen";
import { RecordScreen } from "@/screens/RecordScreen";
import { AttachScreen } from "@/screens/AttachScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { Sheet } from "@/components/sheet";
import { InstallInvite } from "@/components/install-invite";
import { OutageBanner } from "@/components/outage-banner";
import { PushBanner } from "@/components/push-banner";
import { ToastProvider } from "@/components/toast";
import {
  ApiError,
  fetchContacts,
  fetchReviewCount,
  fetchSession,
  createHandoff,
  redeemHandoff,
  session,
  type Contact,
  type Session,
} from "@/lib/api";
import { useOutage } from "@/lib/outage";
import { isIOS, isStandalone } from "@/lib/standalone";
import { openInstallInvite } from "@/components/install-invite";
import { persistStorage, updateNote, type Note, type NoteContact } from "@/lib/notes";
import { resumePending, transcribeNote } from "@/lib/pipeline";
import { afterTransition } from "@/lib/schedule";

export type ContactsState = {
  status: "loading" | "ready" | "error";
  contacts: Contact[];
  // The Type options of the base, for the contact creation form.
  typeOptions: string[];
  error?: string;
};

type Page = 1 | 2 | 3 | 4;

// A notification opens /?valider=<id>: the « Notifications » screen, on that
// call — or on no call in particular when the parameter is empty.
function linkedReview(): string | null {
  const id = new URLSearchParams(window.location.search).get("valider");
  if (id !== null) window.history.replaceState(null, "", window.location.pathname);
  return id;
}

// A phone that scanned the QR code of a computer's settings opens
// /?connexion=<token>. The token signs it in, without a code (api/auth).
//
// On an iPhone the app added to the home screen does not share Safari's
// cookies. So Safari, once signed in, takes an install token and reloads on
// /?installer=<token>: index.html points the install manifest at an address
// that carries it, and the page's own address carries it too — whichever iOS
// takes as the start address, the installed app opens on it and signs itself
// in with that token on its first launch. Safari never spends it.
const QR = "connexion";
const INSTALL = "installer";
const params = new URLSearchParams(window.location.search);
const fragment = new URLSearchParams(window.location.hash.slice(1));
// In the fragment (QR codes made from now on), or the query (older ones).
const qrToken = fragment.get(QR) ?? params.get(QR);
const installToken = params.get(INSTALL);

function forgetParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete(name);
  url.hash = hash.toString();
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export default function App() {
  const [user, setUser] = useState<Session | null>(session.get());
  const [focusId, setFocusId] = useState<string | null>(linkedReview);
  // Changes with every notification tapped, the same one twice included.
  const [focusKey, setFocusKey] = useState(0);
  const [page, setPage] = useState<Page>(focusId !== null ? 4 : 1);
  const [reviewCount, setReviewCount] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const outage = useOutage();
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  // A new key at every opening: the settings start on their first page, with
  // nothing left over from the last visit.
  const [settingsKey, setSettingsKey] = useState(0);
  const [settingsView, setSettingsView] = useState<"main" | "excluded">("main");
  const openSettings = (view: "main" | "excluded" = "main") => {
    setSettingsView(view);
    setSettingsKey((key) => key + 1);
    setSettingsOpen(true);
  };
  const [noteId, setNoteId] = useState<string | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const [contacts, setContacts] = useState<ContactsState>({ status: "loading", contacts: [], typeOptions: [] });

  useEffect(() => {
    void persistStorage();
    void resumePending();
  }, []);

  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handingOff, setHandingOff] = useState(
    Boolean(qrToken) || (Boolean(installToken) && isStandalone() && !session.get()),
  );
  useEffect(() => {
    const installed = isStandalone();
    const signIn = (token: string) =>
      redeemHandoff(token).then((next) => {
        session.set(next);
        setUser(next);
      });
    const failed = (error: unknown) => {
      if (session.get()) return;
      setHandoffError((error as Error).message || "Ce lien n'a pas pu vous connecter.");
    };

    if (installToken) {
      if (!installed) {
        // Safari, back from the reload below: the address keeps its token for
        // the install, and the guide opens.
        if (session.get()) window.setTimeout(openInstallInvite, 400);
        return;
      }
      forgetParam(INSTALL);
      if (session.get()) return;
      signIn(installToken)
        .catch(failed)
        .finally(() => setHandingOff(false));
      return;
    }

    if (!qrToken) return;
    forgetParam(QR);
    signIn(qrToken)
      .then(async () => {
        if (installed) return;
        if (isIOS()) {
          // See above: a token for the app about to be installed, carried by
          // a fresh page whose manifest starts there.
          const { url } = await createHandoff({ install: true }).catch(() => ({ url: null }));
          if (url) return window.location.replace(url);
        }
        // Straight to the install guide: that is what the QR code was for.
        // Left a moment to mount with the signed-in tree.
        window.setTimeout(openInstallInvite, 400);
      })
      .catch(failed)
      .finally(() => setHandingOff(false));
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsExpanded(false);
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
      setFocusKey((key) => key + 1);
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
        pending={handingOff}
        notice={handoffError}
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
    // Finalising the stream is a message and a wait; but if the stream did
    // not carry the dictation, decoding the recording costs tens of
    // milliseconds of main thread, which would land on the frames of the
    // page slide. It waits for the slide to be over.
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
            onReview={() => setPage(4)}
            onSettings={() => openSettings()}
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
          <NotificationsScreen
            active={page === 4}
            contacts={contacts}
            focusId={focusId}
            focusKey={focusKey}
            onBack={() => {
              setFocusId(null);
              setPage(1);
            }}
            onCount={setReviewCount}
            onOpenNote={openNote}
            onOpenExcluded={() => openSettings("excluded")}
            onUnauthorized={signOut}
          />
        </section>
      </div>
      {/* The settings rise over the home screen in a sheet rather than
          sliding in as a page. */}
      {/* One banner at a time: an outage says more than a reminder. */}
      <OutageBanner visible={page === 1 && !settingsOpen} />
      <PushBanner visible={page === 1 && !settingsOpen && !outage} />
      <Sheet open={settingsOpen} onClose={closeSettings} label="Réglages" full={settingsExpanded}>
        <SettingsScreen
          key={settingsKey}
          initialView={settingsView}
          active={settingsOpen}
          email={user.email}
          onBack={closeSettings}
          onSignedOut={signOut}
          onExpand={setSettingsExpanded}
        />
      </Sheet>
    </ToastProvider>
  );
}
