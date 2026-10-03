import { createNotionNote, recentContacts } from "./api";
import { decodeForWhisper } from "./audio";
import { guardEnd } from "./engine-guard";
import { collectLive, onPartial } from "./live-transcript";
import { getNote, listNotes, ready, removeNote, updateNote } from "./notes";
import { EngineError, stepOf, transcribe } from "./transcriber";

// ---- Screen wake lock ---------------------------------------------------
// iOS suspends a tab as soon as the screen locks, which stops both the
// recorder and Whisper. Holding the lock while either runs avoids most of it;
// the IndexedDB resume covers the rest.

let wakeLock: { release(): Promise<void> } | null = null;
let holders = 0;

async function acquire() {
  holders++;
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    wakeLock ??= (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    // Refused (low battery, background tab): carry on without it.
  }
}

function release() {
  holders = Math.max(0, holders - 1);
  if (holders === 0) {
    wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }
}

// The browser drops the lock when the page is hidden; take it back on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && holders > 0 && !wakeLock) {
    holders--;
    void acquire();
  }
});

export const wake = { acquire, release };

// ---- Transcription --------------------------------------------------------

// Engine errors arrive in English and technical; the user needs to know
// whether the network or the phone is the cause — and, before that, at which
// of the three steps it stopped. "Erreur inattendue" told them nothing and
// told us nothing either, which is how a failure can be reported for days
// without anyone knowing where to look.
function cause(message: string) {
  if (/memory|allocation|RangeError/i.test(message)) return "mémoire de l'appareil insuffisante";
  if (/decod/i.test(message)) return "fichier audio illisible";
  if (/network|fetch|load failed|réponse \d/i.test(message)) return `réseau — ${message}`;
  return message;
}

function describe(error: unknown) {
  if (error instanceof EngineError) return `${stepOf(error.stage)} : ${cause(error.message)}`;
  const message = String((error as Error)?.message ?? error);
  // Older shape, still produced by the audio decoder on its own path.
  if (/^fetch: /.test(message)) return `${stepOf("download")} : ${cause(message.replace(/^fetch: /, ""))}`;
  return cause(message);
}

const running = new Set<string>();

// Each utterance that comes back while the dictation is still being
// transcribed lands on the note, so the screen fills in as it goes instead of
// showing a shimmer until the very end.
onPartial((id, text) => void updateNote(id, { partial: text }));

export async function transcribeNote(id: string, attempt = 1): Promise<void> {
  if (running.has(id)) return;
  const note = await getNote(id);
  if (!note || note.transcript) return;

  running.add(id);
  await acquire();
  try {
    await updateNote(id, { status: "transcribing", error: undefined });
    // Most of the dictation has usually been transcribed already, utterance
    // by utterance, while it was being spoken; this waits for what is left.
    // Null means that path did not carry all of it, and the recording is
    // transcribed whole, exactly as it was before.
    const live = await collectLive(id);
    const text = live ?? (await transcribe(id, await decodeForWhisper(note.audio))).text;
    if (!text) {
      await updateNote(id, { status: "transcription-failed", error: "aucune parole détectée" });
      return;
    }
    await updateNote(id, { status: "transcribed", transcript: text, partial: undefined });
  } catch (error) {
    // One silent retry covers a worker killed while the phone was locked.
    if (attempt < 2) {
      running.delete(id);
      release();
      return transcribeNote(id, attempt + 1);
    }
    await updateNote(id, { status: "transcription-failed", error: describe(error) });
  } finally {
    // The tab survived the whole thing: the breadcrumb comes back up.
    guardEnd();
    if (running.delete(id)) release();
  }
}

// ---- Sending --------------------------------------------------------------

export async function sendNote(id: string, files: { id: string; name: string }[] = []) {
  const note = await getNote(id);
  if (!note?.transcript || note.contact === undefined) throw new Error("Note incomplète");
  await updateNote(id, { status: "sending", error: undefined });
  try {
    const page = await createNotionNote({
      clientId: note.id,
      transcript: note.transcript,
      contactId: note.contact?.id ?? null,
      recordedAt: new Date(note.createdAt).toLocaleDateString("sv-SE"),
      files,
    });
    if (note.contact) recentContacts.push(note.contact.id);
    // Notion confirmed the page: only now is the audio let go.
    await removeNote(id);
    return page;
  } catch (error) {
    await updateNote(id, { status: "send-failed", error: (error as Error).message });
    throw error;
  }
}

// ---- Resume ---------------------------------------------------------------

// Picks up whatever a closed or killed tab left behind.
export async function resumePending() {
  await ready;
  for (const note of listNotes()) {
    if (note.status === "recording") {
      // The recorder saves every few seconds: keep what was captured.
      await updateNote(note.id, { status: "recorded" });
    } else if (note.status === "sending") {
      // The response was lost; the user decides whether to send again.
      await updateNote(note.id, { status: "send-failed", error: "Envoi interrompu" });
    }
  }
  for (const note of listNotes()) {
    if (!note.transcript && (note.status === "recorded" || note.status === "transcribing")) {
      void transcribeNote(note.id);
    }
  }
}
