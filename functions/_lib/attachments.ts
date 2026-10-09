// Which mail attachments are files worth keeping, and what to call them.
//
// The panel applies the same rules before showing anything (see
// src/outlook/attachments.ts, which cannot import this file: the two are
// separate TypeScript projects). The server applies them again because the
// panel is not an authority: a request naming an inline logo is refused here
// whatever the panel thought of it.

export type GraphAttachmentKind = "file" | "item" | "reference";

export type GraphAttachment = {
  "@odata.type"?: string;
  name?: string;
  size?: number;
  contentType?: string;
  isInline?: boolean;
};

export function kindOf(attachment: GraphAttachment): GraphAttachmentKind {
  const type = (attachment["@odata.type"] ?? "").toLowerCase();
  if (type.endsWith("itemattachment")) return "item";
  if (type.endsWith("referenceattachment")) return "reference";
  return "file";
}

/**
 * Not an attachment anybody chose to send:
 *  - an image placed in the body (a signature logo, a pasted screenshot);
 *  - winmail.dat, Outlook's own TNEF envelope;
 *  - a calendar invitation, which is the meeting rather than a document.
 */
export function technical(attachment: GraphAttachment): boolean {
  if (attachment.isInline) return true;
  const name = (attachment.name ?? "").trim().toLowerCase();
  const type = (attachment.contentType ?? "").toLowerCase();
  if (name === "winmail.dat" || type === "application/ms-tnef" || type === "application/vnd.ms-tnef") return true;
  if (name.endsWith(".ics") || name.endsWith(".vcs") || type.startsWith("text/calendar")) return true;
  return false;
}

/** A mail attached to a mail comes out of Graph as MIME, so it is saved as one. */
export function fileNameOf(attachment: GraphAttachment): string {
  const name = (attachment.name ?? "").trim() || "pièce jointe";
  return kindOf(attachment) === "item" && !/\.eml$/i.test(name) ? `${name}.eml` : name;
}

export function contentTypeOf(attachment: GraphAttachment): string {
  if (kindOf(attachment) === "item") return "message/rfc822";
  return attachment.contentType?.trim() || "application/octet-stream";
}
