import { createHash } from "node:crypto";
import type { Meeting } from "./payload.js";

// One meeting, one note — even when several colleagues record it and Read AI
// produces one report each, with a session id of its own (brief §6,
// research C-1, C-2).

export const keyOf = (meeting: Pick<Meeting, "platform" | "platformMeetingId" | "sessionId">) =>
  meeting.platformMeetingId
    ? `readai:${meeting.platform}:${meeting.platformMeetingId}`
    : `readai:session:${meeting.sessionId}`;

export const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/**
 * What the fallback compares, and all it keeps: digests and a time. The index
 * is operational data, and the constitution keeps names and addresses of
 * participants out of everything but a call waiting for a decision.
 */
export type Trace = { t: string; s: number; x: string[]; at: number };

export const traceOf = (title: string, start: string, externals: string[]): Trace => ({
  t: fingerprint(title.trim().toLowerCase()),
  s: Date.parse(start) || 0,
  x: externals.map(fingerprint),
  at: Date.now(),
});

/** Ten minutes between two starts still makes one meeting. */
export const WINDOW_MS = 10 * 60_000;

/** Same title, starts less than ten minutes apart, at least one external in common. */
export function sameMeeting(a: Trace, b: Trace): boolean {
  if (a.t !== b.t) return false;
  if (!a.s || !b.s || Math.abs(a.s - b.s) >= WINDOW_MS) return false;
  return a.x.some((digest) => b.x.includes(digest));
}

/** Kept three days: long enough for a late report, short enough to stay small. */
export const RECENT_MS = 3 * 24 * 3600_000;

/** The key of an earlier meeting this one is a recording of, if any. */
export function findSame(trace: Trace, recent: Record<string, Trace>): string | null {
  for (const [key, other] of Object.entries(recent)) {
    if (Date.now() - other.at > RECENT_MS) continue;
    if (sameMeeting(trace, other)) return key;
  }
  return null;
}
