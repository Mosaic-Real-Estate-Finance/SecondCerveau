import { useSyncExternalStore } from "react";
import { detectDevice, isStandalone } from "@/lib/standalone";

// When to ask how a dictation went. Not after every one: after the first
// that reaches Notion, the third and the sixth — the first day, while the
// app is new — and never again once it has become a habit. Counted on this
// device, which is where the habit is.

const KEY = "mosaic-feedback";
/** Sends after which the question comes; none after the last. */
const ASK_AFTER = [1, 3, 6];

type State = { sent: number; due: boolean };

function load(): State {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<State> | null;
    return { sent: Number(raw?.sent) || 0, due: raw?.due === true };
  } catch {
    return { sent: 0, due: false };
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: the count lasts as long as the app is open.
  }
  listeners.forEach((listener) => listener());
}

/** A dictation has just been written to Notion. */
export function noteSent() {
  const sent = state.sent + 1;
  set({ sent, due: state.due || ASK_AFTER.includes(sent) });
}

/** The question has been put: it is not asked again for this send. */
export function feedbackAsked() {
  if (state.due) set({ ...state, due: false });
}

export function useFeedbackDue(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state.due,
  );
}

export type Feeling = "satisfied" | "problem";

const DEVICE = { iphone: "iPhone", ipad: "iPad", android: "Android", other: "Ordinateur" } as const;

/** Written to « Retours sur l'app » (functions/api/feedback.ts). */
export async function sendFeedback(feeling: Feeling, text: string) {
  const response = await fetch("/api/auth/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      feeling,
      text: text.trim(),
      count: state.sent,
      device: `${DEVICE[detectDevice()]}${isStandalone() ? " · app installée" : " · navigateur"}`,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Le retour n'a pas pu être envoyé. Réessayez.");
  }
}
