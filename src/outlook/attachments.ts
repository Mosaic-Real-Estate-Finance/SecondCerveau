import type { AttachmentRef, ThreadMessage } from "./api";

// Which attachments of the thread the panel offers to import (feature 003).
//
// The same exclusions are applied again by the server, in
// functions/_lib/attachments.ts: this copy decides what the panel shows, that
// one decides what is actually fetched. They cannot share a file — the panel
// and the functions are separate TypeScript projects — so a change to one is a
// change to both.

export type Candidate = AttachmentRef & {
  /** Name and size: what makes two attachments the same file. */
  key: string;
  /** The name the file will carry in Notion. */
  label: string;
  /** "ready" can be imported; the others are shown with their reason. */
  state: "ready" | "too-big" | "unavailable";
  reason?: string;
  /** The user's choice. Only meaningful on a "ready" file. */
  selected: boolean;
};

/**
 * Not an attachment anybody chose to send, and therefore never shown: an
 * image in the body (a signature logo, a pasted screenshot), Outlook's
 * winmail.dat envelope, a calendar invitation.
 */
export function technical(ref: AttachmentRef): boolean {
  if (ref.inline) return true;
  const name = ref.name.trim().toLowerCase();
  const type = ref.contentType.toLowerCase();
  if (name === "winmail.dat" || type === "application/ms-tnef" || type === "application/vnd.ms-tnef") return true;
  if (name.endsWith(".ics") || name.endsWith(".vcs") || type.startsWith("text/calendar")) return true;
  return false;
}

/** A mail attached to a mail is saved as a .eml, the way the server names it. */
export const labelOf = (ref: AttachmentRef) => {
  const name = ref.name.trim() || "pièce jointe";
  return ref.kind === "item" && !/\.eml$/i.test(name) ? `${name}.eml` : name;
};

const keyOf = (ref: AttachmentRef) => `${labelOf(ref).toLowerCase()}\n${ref.size}`;

/** "6,2 Mo", "840 Ko": a size the way a person reads it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  const value = bytes / (1024 * 1024);
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded).replace(".", ",")} Mo`;
}

/**
 * The files the panel offers, from the messages that are about to be written.
 *
 * `earlier` are the messages already in the note. Their files are never
 * offered again, and neither is a file one of them already carried: a forward
 * that re-attaches the offer of three messages ago is the same offer, and the
 * note has it. Within `written`, the same rule keeps the first occurrence.
 *
 * `limit` is the per file limit of the Notion workspace, or null when it could
 * not be read; the server checks it again on the real size either way.
 */
export function candidates(written: ThreadMessage[], earlier: ThreadMessage[], limit: number | null): Candidate[] {
  const seen = new Set(
    earlier
      .flatMap((message) => message.attachments ?? [])
      .filter((ref) => !technical(ref))
      .map(keyOf),
  );
  const out: Candidate[] = [];
  for (const message of written) {
    for (const ref of message.attachments ?? []) {
      if (technical(ref)) continue;
      const key = keyOf(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      const base = { ...ref, key, label: labelOf(ref), selected: false };
      if (ref.kind === "reference") {
        out.push({ ...base, state: "unavailable", reason: "Lien vers un fichier en ligne, pas un fichier joint." });
      } else if (limit !== null && ref.size > limit) {
        out.push({
          ...base,
          state: "too-big",
          reason: `Trop lourd : ${sizeLabel(ref.size)}, maximum ${sizeLabel(limit)}.`,
        });
      } else {
        out.push({ ...base, state: "ready", selected: true });
      }
    }
  }
  return out;
}

/** What will actually be sent, and how much it weighs. */
export function chosen(files: Candidate[]) {
  const picked = files.filter((file) => file.state === "ready" && file.selected);
  return { picked, bytes: picked.reduce((total, file) => total + file.size, 0) };
}
