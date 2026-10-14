// Stands in for src/lib/notes.ts in the screenshot build: no stored notes,
// and the note being dictated carries the live text.
import { useSyncExternalStore } from "react";
import { partial, subscribe } from "./dictation";
export type { Note, NoteContact, NoteStatus } from "@/lib/notes";

export const storageIsDurable = () => true;
export const useNotes = () => [];

export function useNote(id: string | null) {
  const text = useSyncExternalStore(subscribe, partial);
  return id ? { partial: text } : undefined;
}
