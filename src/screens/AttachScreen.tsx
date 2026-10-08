import { useEffect, useRef, useState } from "react";
import { PrimaryButton, Screen, TextButton, TopBar } from "@/components/screen";
import { Shimmer } from "@/components/shimmer";
import { SuccessCheck } from "@/components/success-check";
import { useToast } from "@/components/toast";
import { ApiError, uploadFile, type NoteFile } from "@/lib/api";
import { removeNote, useNote } from "@/lib/notes";
import { sendNote, transcribeNote } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

// The Notion mark, monochrome (Simple Icons).
function NotionLogo({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}

// The last step. A document or a photo may be attached — it is optional —
// and then the note goes to Notion.
//
// The transcription is very often still running when this screen opens: the
// dictation is transcribed utterance by utterance while it is spoken, and
// the tail is still in the engine. That is the point of this step being
// here. Pressing the button while it runs does not fail and does not make
// the user press again; the send waits for the text and goes by itself.

const MEGA = 1024 * 1024;
const size = (bytes: number) => (bytes < MEGA ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${Math.round((bytes / MEGA) * 10) / 10} Mo`);

type Attachment = {
  key: string;
  name: string;
  bytes: number;
  status: "uploading" | "ready" | "failed";
  ref?: NoteFile;
  error?: string;
};

const num = (name: string, fallback: number) => {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
};

export function AttachScreen({
  active,
  noteId,
  onChangeContact,
  onBack,
  onDone,
  onUnauthorized,
}: {
  active: boolean;
  noteId: string | null;
  onChangeContact: () => void;
  onBack: () => void;
  onDone: () => void;
  onUnauthorized: () => void;
}) {
  const note = useNote(noteId);
  const toast = useToast();
  const [files, setFiles] = useState<Attachment[]>([]);
  // idle → waiting (the text is not in yet) → sending → sent.
  const [phase, setPhase] = useState<"idle" | "waiting" | "sending" | "sent">("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The page Notion created, kept for the confirmation screen: the note
  // itself is gone from the device by then.
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLDivElement>(null);
  const revert = useRef(0);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    setPhase("idle");
    setConfirmDelete(false);
    setPageUrl(null);
    top.current?.closest(".t-page")?.scrollTo({ top: 0 });
  }, [active, noteId]);

  // A different dictation is a different set of attachments.
  useEffect(() => setFiles([]), [noteId]);

  const add = async (chosen: FileList | null) => {
    const list = [...(chosen ?? [])];
    if (!list.length) return;
    const added = list.map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      name: file.name,
      bytes: file.size,
      status: "uploading" as const,
    }));
    setFiles((current) => [...current, ...added]);
    await Promise.all(
      list.map(async (file, index) => {
        const { key } = added[index];
        try {
          const ref = await uploadFile(file);
          setFiles((current) =>
            current.map((item) => (item.key === key ? { ...item, status: "ready", ref } : item)),
          );
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return onUnauthorized();
          setFiles((current) =>
            current.map((item) =>
              item.key === key ? { ...item, status: "failed", error: (error as Error).message } : item,
            ),
          );
        }
      }),
    );
  };

  // transitions.dev 12, error state shake, driven as in the snippet.
  const showError = () => {
    const w = wrap.current;
    const b = button.current;
    if (!w || !b) return;
    w.classList.add("is-error");
    b.classList.add("is-error");
    b.classList.remove("is-shaking");
    void b.offsetWidth;
    b.classList.add("is-shaking");
    const shakeMs = num("--shake-dur-a", 80) * 2 + num("--shake-dur-b", 60) * 2;
    setTimeout(() => b.classList.remove("is-shaking"), shakeMs + 20);
    clearTimeout(revert.current);
    revert.current = window.setTimeout(() => {
      w.classList.remove("is-error");
      b.classList.remove("is-error");
    }, shakeMs + num("--revert-hold", 3000));
  };

  // Armed by the button, fired by the effect below once the text is in.
  //
  // The send is held by a ref rather than by the effect's own cleanup: this
  // effect watches `phase`, and the send changes `phase` — and the status of
  // the note, twice. A cleanup that cancelled on those would cancel the very
  // send that caused them, which it did: the note reached Notion and the
  // screen never heard about it.
  const inFlight = useRef(false);
  useEffect(() => {
    if (phase !== "waiting" || !note || inFlight.current) return;
    if (note.status === "transcription-failed") {
      setPhase("idle");
      showError();
      toast.show("La transcription a échoué, la note ne peut pas partir.");
      return;
    }
    if (!note.transcript) return;
    inFlight.current = true;
    setPhase("sending");
    void (async () => {
      try {
        const page = await sendNote(
          note.id,
          files.flatMap((file) => (file.ref ? [{ id: file.ref.id, name: file.ref.name }] : [])),
        );
        setPageUrl(page.url);
        // Back to the home screen on its own after ten seconds, shown by the
        // bar along the top; « Fermer » leaves sooner.
        setPhase("sent");
      } catch (error) {
        setPhase("idle");
        if (error instanceof ApiError && error.status === 401) onUnauthorized();
        else {
          showError();
          toast.show("Envoi impossible. La note reste en attente sur ce téléphone.");
        }
      } finally {
        inFlight.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, note?.transcript, note?.status]);

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    if (note) await removeNote(note.id);
    onDone();
  };

  // Before the note is looked at, not after: Notion confirming the page is
  // what takes the note out of the database, so by the time this screen has
  // something to celebrate it no longer has a note to read.
  if (phase === "sent") {
    return (
      <Screen className="items-center justify-center text-center">
        <CloseCountdown onEnd={onDone} />
        <SuccessCheck show />
        <h1 className="mt-6 font-serif text-2xl">Note envoyée</h1>
        <p className="mt-2 text-base text-[color:var(--muted)]">Notion AI génère le résumé.</p>
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-white-smoke px-5 py-3 text-base font-medium text-navy"
          >
            <NotionLogo className="h-5 w-5 shrink-0" />
            <span>Ouvrir la note dans Notion ↗</span>
          </a>
        )}
        <button
          type="button"
          onClick={onDone}
          className={cn("text-sm text-[color:var(--muted)] underline underline-offset-2", pageUrl ? "mt-4" : "mt-8")}
        >
          Fermer
        </button>
      </Screen>
    );
  }

  if (!note) return <Screen />;

  const uploading = files.some((file) => file.status === "uploading");
  const failed = note.status === "transcription-failed";
  const busy = phase !== "idle";
  const label =
    phase === "sending" ? "Envoi en cours" : phase === "waiting" ? "Transcription en cours" : "Envoyer dans Notion";

  return (
    <Screen>
      <div ref={top} />
      <TopBar title="Besoin d'ajouter un document ou une photo ?" onBack={onBack} backLabel="Accueil" />

      <p className="-mt-4 mb-6 text-2xs text-[color:var(--muted)]">
        Facultatif. La note part avec ou sans pièce jointe.
      </p>

      <div className="flex min-h-16 items-center justify-between gap-3 rounded-2xl bg-white-smoke px-4 py-3">
        <span className="min-w-0">
          <span className="block text-xs text-[color:var(--muted)]">Contact</span>
          <span className="block truncate text-base font-medium">
            {note.contact ? note.contact.name : "Sans contact"}
            {note.contact?.company ? `, ${note.contact.company}` : ""}
          </span>
        </span>
        <TextButton onClick={onChangeContact} className="-mr-3 shrink-0">
          Modifier
        </TextButton>
      </div>

      <input
        ref={picker}
        type="file"
        multiple
        // Everything a phone offers: the photo library, the camera, and the
        // files app. No accept list, because a client sends what a client
        // sends — a plan, a scan, a spreadsheet.
        className="sr-only"
        onChange={(event) => {
          void add(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => picker.current?.click()}
        className="mt-4 flex min-h-16 w-full items-center gap-3 rounded-2xl bg-white-smoke px-4 py-3 text-left"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-navy" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="min-w-0">
          <span className="block text-base font-medium text-navy">Ajouter un fichier</span>
          <span className="block text-xs text-[color:var(--muted)]">Photo, PDF, document</span>
        </span>
      </button>

      {files.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {files.map((file) => (
            <li
              key={file.key}
              className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-white-smoke px-4 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-base">{file.name}</span>
                <span
                  className={cn("block text-xs", file.status === "failed" ? "text-navy" : "text-[color:var(--muted)]")}
                >
                  {file.status === "uploading"
                    ? "Envoi…"
                    : file.status === "failed"
                      ? (file.error ?? "Échec de l'envoi")
                      : size(file.bytes)}
                </span>
              </span>
              <TextButton
                onClick={() => setFiles((current) => current.filter((item) => item.key !== file.key))}
                className="-mr-3 shrink-0 text-xs"
                aria-label={`Retirer ${file.name}`}
              >
                Retirer
              </TextButton>
            </li>
          ))}
        </ul>
      )}

      <div className="flex-1" aria-hidden />

      <div
        className="sticky bottom-0 -mx-4 mt-8 bg-white px-4 pt-3"
        style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }}
      >
        {/* Said once, quietly: the text itself is no longer shown here. */}
        <p className="mb-2 text-center text-2xs text-[color:var(--muted)]">
          {failed ? (
            <>
              La transcription a échoué{note.error ? ` : ${note.error}` : ""}.{" "}
              <button type="button" onClick={() => transcribeNote(note.id)} className="underline">
                Réessayer
              </button>
            </>
          ) : note.transcript ? (
            "Le texte sera corrigé par Notion AI."
          ) : (
            <Shimmer className="text-2xs">Transcription en cours, l'envoi l'attendra</Shimmer>
          )}
        </p>
        <div ref={wrap} className="t-input-wrap">
          <div ref={button} className="send-button t-input rounded-[18px]">
            <PrimaryButton onClick={() => setPhase("waiting")} disabled={busy || uploading || failed}>
              {uploading ? "Fichier en cours d'envoi" : label}
            </PrimaryButton>
          </div>
          <p className="t-error-msg mt-2 text-xs" role="alert">
            {note.error && note.status === "send-failed" ? note.error : "Envoi impossible."}
          </p>
        </div>
        <div className="flex justify-center">
          <TextButton onClick={remove} onBlur={() => setConfirmDelete(false)}>
            {confirmDelete ? "Confirmer la suppression" : "Supprimer la note"}
          </TextButton>
        </div>
      </div>
    </Screen>
  );
}

// The bar empties over ten seconds and closes the screen when it runs out.
// It pauses while the app is in the background — opening the note in Notion
// does not eat the countdown.
function CloseCountdown({ onEnd }: { onEnd: () => void }) {
  const [paused, setPaused] = useState(() => document.hidden);
  useEffect(() => {
    const sync = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return (
    <div className="close-countdown" aria-hidden>
      <div
        className="close-countdown-bar"
        style={{ animationPlayState: paused ? "paused" : "running" }}
        onAnimationEnd={onEnd}
      />
    </div>
  );
}
