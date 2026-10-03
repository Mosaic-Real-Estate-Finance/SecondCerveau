import { createStore, del, get, set, values } from "idb-keyval";
import { useSyncExternalStore } from "react";

// A note lives from the first seconds of recording until Notion confirms the
// write. Every step saves its result, so a tab killed by iOS resumes from the
// last completed step instead of losing the dictation.
//
// Two rules make that hold on iOS, both learned the hard way:
//
// 1. The audio is stored as raw bytes, never as a Blob. WebKit stores a Blob
//    in IndexedDB as a reference to a file it manages itself, and that file
//    can be gone when the record is read back — the read then fails with
//    "The object can not be found here", and the recording is lost for good.
//    An ArrayBuffer is copied into the database by value, so nothing can go
//    missing. (WebKit bugs 188438 and 198278; in Private Browsing a Blob
//    cannot be stored at all.)
//
// 2. Memory is the source of truth for the session and the database is the
//    durability layer underneath it, not the other way round. A write that
//    fails — no room, database blocked, Private Browsing — costs the crash
//    safety net, never the recording in hand.

export type NoteContact = { id: string; name: string; company: string } | null;

export type NoteStatus =
  | "recording"
  | "recorded"
  | "transcribing"
  | "transcribed"
  | "transcription-failed"
  | "sending"
  | "send-failed";

export type Note = {
  id: string;
  createdAt: number;
  status: NoteStatus;
  /** The recording itself, by value. Empty while the first chunk is awaited. */
  audio: ArrayBuffer;
  /** The MediaRecorder container, needed to decode and to play the bytes back. */
  mimeType: string;
  duration: number;
  amplitudes: number[];
  transcript?: string;
  /** What has come back so far while the dictation is still being transcribed. */
  partial?: string;
  // undefined: not chosen yet. null: sent without a contact, on purpose.
  contact?: NoteContact;
  error?: string;
};

const store = createStore("mosaic-dictee", "notes");

/** Bytes from anything, with the fallback older WebKit needs. */
export async function toBytes(source: Blob | ArrayBuffer): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (typeof source.arrayBuffer === "function") return source.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Lecture impossible"));
    reader.readAsArrayBuffer(source);
  });
}

// ---- The session's notes --------------------------------------------------

const memory = new Map<string, Note>();
let snapshot: Note[] = [];
const listeners = new Set<() => void>();

/** False once a write has failed: the screens say so rather than pretending. */
let durable = true;
export const storageIsDurable = () => durable;

function publish() {
  snapshot = [...memory.values()].sort((a, b) => b.createdAt - a.createdAt);
  listeners.forEach((listener) => listener());
}

// Best effort by design: the note is already in memory when this runs.
async function persist(note: Note) {
  try {
    await set(note.id, note, store);
    durable = true;
  } catch {
    durable = false;
  }
}

// Records written by an earlier version hold a Blob. Read what can still be
// read, and rewrite it as bytes; a Blob whose file WebKit has lost throws
// here, and the note is kept without its audio rather than poisoning a read
// on every launch.
async function migrate(note: Note & { audio: unknown }): Promise<Note> {
  if (note.audio instanceof ArrayBuffer) return note as Note;
  const mimeType = note.mimeType ?? (note.audio as Blob)?.type ?? "audio/mp4";
  try {
    const audio = await toBytes(note.audio as Blob);
    const fixed = { ...note, audio, mimeType } as Note;
    void persist(fixed);
    return fixed;
  } catch {
    return {
      ...(note as Note),
      audio: new ArrayBuffer(0),
      mimeType,
      status: note.transcript ? note.status : "transcription-failed",
      error: note.transcript ? note.error : "enregistrement perdu par le navigateur",
    };
  }
}

// ---- The text, mirrored ---------------------------------------------------
// A recording can always be transcribed again; a transcript whose record is
// gone cannot be recovered. Everything about a note except its audio is a
// few hundred bytes, so it is also kept in localStorage — synchronous, and
// readable even when the database will not open at all. The audio is not:
// the mirror is what lets a dictation still be sent, not re-transcribed.

const MIRROR_KEY = "mosaic-notes-mirror";
const MIRROR_KEEP = 20;
const MIRROR_BARS = 64;

type Mirrored = Omit<Note, "audio" | "mimeType">;

const readMirror = (): Mirrored[] => {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? (JSON.parse(raw) as Mirrored[]) : [];
  } catch {
    return [];
  }
};

function writeMirror() {
  const rows = [...memory.values()]
    .filter((note) => note.transcript)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MIRROR_KEEP)
    .map(({ audio: _audio, mimeType: _mimeType, amplitudes, ...rest }) => ({
      ...rest,
      amplitudes: fold(amplitudes, MIRROR_BARS),
    }));
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(rows));
  } catch {
    // Full or blocked: the database is still there, this was the spare.
  }
}

const fold = (values: number[], bars: number) =>
  values.length <= bars
    ? values
    : Array.from({ length: bars }, (_, i) => values[Math.floor((i * values.length) / bars)]);

async function load() {
  try {
    for (const stored of await values<Note>(store)) {
      memory.set(stored.id, await migrate(stored as Note & { audio: unknown }));
    }
  } catch {
    durable = false;
  }
  // Whatever the database could not give back, with its text intact.
  for (const row of readMirror()) {
    if (memory.has(row.id)) continue;
    memory.set(row.id, { ...row, audio: new ArrayBuffer(0), mimeType: "audio/mp4" });
  }
  // Written on every launch, not only when a note changes: a note
  // transcribed in an earlier session would otherwise never reach the
  // mirror, which is exactly the note that most needs to be in it.
  writeMirror();
  publish();
}

export const ready = load();

export const listNotes = () => snapshot;

/** Memory first: it is always the newest, and it cannot fail. */
export async function getNote(id: string): Promise<Note | undefined> {
  const held = memory.get(id);
  if (held) return held;
  try {
    const stored = await get<Note>(id, store);
    if (!stored) return undefined;
    const note = await migrate(stored as Note & { audio: unknown });
    memory.set(id, note);
    return note;
  } catch {
    durable = false;
    return undefined;
  }
}

/** Never rejects: the note is in memory before the database is touched. */
export async function saveNote(note: Note) {
  memory.set(note.id, note);
  publish();
  if (note.transcript) writeMirror();
  await persist(note);
  return note;
}

// Transcription can finish while the user picks a contact: updates to one note
// are chained so neither read-modify-write overwrites the other.
const pending = new Map<string, Promise<unknown>>();

export function updateNote(id: string, patch: Partial<Note>): Promise<Note | undefined> {
  const run = (pending.get(id) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const note = await getNote(id);
      if (!note) return undefined;
      return saveNote({ ...note, ...patch });
    });
  pending.set(id, run);
  return run;
}

// Only called once Notion has confirmed the page, or when the user deletes.
export async function removeNote(id: string) {
  memory.delete(id);
  publish();
  writeMirror();
  try {
    await del(id, store);
  } catch {
    durable = false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotes() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

export function useNote(id: string | null) {
  const notes = useNotes();
  return id ? notes.find((note) => note.id === id) : undefined;
}

// Asks the browser not to evict the audio and the model under storage pressure.
export async function persistStorage() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // Not supported everywhere; eviction is then the browser's call.
  }
}
