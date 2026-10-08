import { createHmac, timingSafeEqual } from "node:crypto";

// What Read AI sends, verified and reduced to what the note needs.
//
// Source: "Getting Started with Webhooks", Read AI help centre, read on
// 2026-10-08 (research B-1, B-3). Nothing outside `Meeting` is ever kept: the
// action items, key questions, topics and chapters are dropped here, before
// anything can store them.

export type Person = { name: string; firstName: string; lastName: string; email: string | null };

/** One turn of the transcript. `at` is milliseconds since the meeting began. */
export type SpeakerBlock = { at: number; speaker: string; words: string };

export type Meeting = {
  sessionId: string;
  title: string;
  /** ISO, UTC. */
  start: string;
  end: string | null;
  owner: Person | null;
  participants: Person[];
  summary: string;
  blocks: SpeakerBlock[];
  platform: string;
  platformMeetingId: string | null;
  reportUrl: string | null;
};

/**
 * The X-Read-Signature check.
 *
 * The signing key is shown base64 encoded in Read AI, and their own samples —
 * Python, JavaScript, Go and Ruby alike — decode it before keying the HMAC.
 * Keying with the base64 text itself would produce a different digest on
 * every request, which is exactly the failure that looks like "Read AI signs
 * badly". The digest is hex, over the raw bytes of the body, compared in
 * constant time; a header of another length is refused without comparing.
 */
export function verifySignature(raw: string | Uint8Array, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const key = Buffer.from(secret.trim(), "base64");
  if (!key.length) return false;
  const digest = createHmac("sha256", key).update(raw).digest("hex");
  const given = header.trim().toLowerCase();
  if (given.length !== digest.length) return false;
  return timingSafeEqual(Buffer.from(digest), Buffer.from(given));
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function personOf(value: unknown): Person | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const email = text(raw.email).toLowerCase();
  const firstName = text(raw.first_name);
  const lastName = text(raw.last_name);
  const name = text(raw.name) || [firstName, lastName].filter(Boolean).join(" ");
  if (!name && !email) return null;
  return { name, firstName, lastName, email: email.includes("@") ? email : null };
}

/**
 * Milliseconds since the start, for each block.
 *
 * Block times are Unix milliseconds sent as strings. The reference is the
 * meeting's own start; when that is unreadable or comes after the first block
 * — a recording started before the scheduled time — the first block becomes
 * the reference instead, so no stamp is ever negative.
 */
function blocksOf(transcript: unknown, start: string): SpeakerBlock[] {
  const list = (transcript as { speaker_blocks?: unknown[] } | null)?.speaker_blocks;
  if (!Array.isArray(list)) return [];
  const raw = list
    .map((block) => {
      const item = (block ?? {}) as Record<string, unknown>;
      return {
        time: Number(item.start_time),
        speaker: text((item.speaker as Record<string, unknown> | undefined)?.name) || "Intervenant",
        words: text(item.words),
      };
    })
    .filter((block) => block.words);
  const times = raw.map((block) => block.time).filter(Number.isFinite);
  const first = times.length ? Math.min(...times) : NaN;
  let base = Date.parse(start);
  if (!Number.isFinite(base) || (Number.isFinite(first) && base > first)) base = first;
  let previous = 0;
  return raw.map((block) => {
    const at = Number.isFinite(block.time) && Number.isFinite(base) ? Math.max(0, block.time - base) : previous;
    previous = at;
    return { at, speaker: block.speaker, words: block.words };
  });
}

/** A `meeting_end` payload as a Meeting, or null when it is not one. */
export function parseMeeting(payload: unknown): Meeting | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const sessionId = text(raw.session_id);
  if (!sessionId) return null;
  const start = text(raw.start_time) || new Date().toISOString();
  const participants = Array.isArray(raw.participants)
    ? raw.participants.map(personOf).filter((person): person is Person => person !== null)
    : [];
  return {
    sessionId,
    title: text(raw.title),
    start,
    end: text(raw.end_time) || null,
    owner: personOf(raw.owner),
    participants,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    blocks: blocksOf(raw.transcript, start),
    platform: text(raw.platform).toLowerCase() || "read",
    platformMeetingId: text(raw.platform_meeting_id) || null,
    reportUrl: text(raw.report_url) || null,
  };
}

/** "07:42", or "1:07:42" past the hour. */
export function clock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}
