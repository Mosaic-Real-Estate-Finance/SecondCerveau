import { notion, notionSend, type Env } from "./notion.js";

// Handing bytes to Notion, for every tool that attaches a file to a note.
//
// It lived in functions/api/files.ts, where the dictation only ever needed the
// single part mode. The Outlook add-in brings mail attachments of several
// tens of megabytes, so the multi part mode joins it here; the dictation keeps
// calling the same function with its own ceiling and sees no difference.
// https://developers.notion.com/docs/working-with-files-and-media
// https://developers.notion.com/docs/sending-larger-files

/** The ceiling of the single part mode, whatever the workspace allows. */
export const SINGLE_PART_MAX = 20 * 1024 * 1024;

/** Notion takes parts of 5 to 20 MiB, the last one smaller; it recommends 10. */
export const PART_SIZE = 10 * 1024 * 1024;

export const mb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

/** "6,2 Mo", the way the panel and the dictation both write a size. */
export const megabytes = (bytes: number) => `${String(mb(bytes)).replace(".", ",")} Mo`;

// Notion caps a filename at 900 bytes, and a name carrying a path separator
// is a name the user never typed.
export function safeName(raw: string) {
  const base = (raw.split(/[/\\]/).pop() ?? "").trim() || "fichier";
  const bytes = new TextEncoder().encode(base);
  if (bytes.length <= 900) return base;
  return new TextDecoder().decode(bytes.slice(0, 900)).replace(/�$/, "");
}

/** How many parts a file of this size is sent in. 1 means single part. */
export const partsFor = (size: number) => (size <= SINGLE_PART_MAX ? 1 : Math.ceil(size / PART_SIZE));

export class UploadRefused extends Error {}

/**
 * Uploads a file and returns the id of the file upload, ready to be attached
 * to a page within the hour — an upload never attached expires on Notion's
 * side, which is the cleanup we want for a send that failed afterwards.
 */
export async function uploadToNotion(env: Env, file: Blob, rawName: string, contentType?: string): Promise<string> {
  const name = safeName(rawName);
  const type = contentType || file.type || "application/octet-stream";
  const parts = partsFor(file.size);

  const upload = await notion<{ id: string }>(env, "/file_uploads", {
    method: "POST",
    body:
      parts === 1
        ? { mode: "single_part", filename: name, content_type: type }
        : { mode: "multi_part", number_of_parts: parts, filename: name, content_type: type },
  });

  if (parts === 1) {
    const body = new FormData();
    body.append("file", new Blob([file], { type }), name);
    const sent = await notionSend<{ status: string }>(env, `/file_uploads/${upload.id}/send`, body);
    if (sent.status !== "uploaded") throw new UploadRefused("Notion n'a pas accepté le fichier");
    return upload.id;
  }

  // In order and one at a time: Notion would take them in parallel, but each
  // part is 10 MiB held in memory, and the rate limit is shared with
  // everything else the integration does.
  for (let part = 1; part <= parts; part += 1) {
    const body = new FormData();
    body.append("file", new Blob([file.slice((part - 1) * PART_SIZE, part * PART_SIZE)], { type }), name);
    body.append("part_number", String(part));
    await notionSend(env, `/file_uploads/${upload.id}/send`, body);
  }
  const done = await notion<{ status: string }>(env, `/file_uploads/${upload.id}/complete`, { method: "POST", body: {} });
  if (done.status !== "uploaded") throw new UploadRefused("Notion n'a pas accepté le fichier");
  return upload.id;
}
