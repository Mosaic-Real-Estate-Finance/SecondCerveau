import { fail, guard, json, maxUploadBytes, notion, notionSend, type Handler } from "../_lib/notion";

// A document or a photo attached to a dictation, uploaded to Notion and
// handed back as a reference the note creation puts in its Fichier column.
//
// Two calls on Notion's side: one to open the upload, one to send the bytes.
// Only the single part mode is used — it covers 20 MiB, and a free workspace
// stops at 5 MiB anyway, which is well past a photo from a phone.
// https://developers.notion.com/docs/working-with-files-and-media

/** The ceiling of the single part mode, whatever the workspace allows. */
const SINGLE_PART_MAX = 20 * 1024 * 1024;

const mb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

// Notion caps a filename at 900 bytes, and a name carrying a path separator
// is a name the user never typed.
function safeName(raw: string) {
  const base = (raw.split(/[/\\]/).pop() ?? "").trim() || "fichier";
  const bytes = new TextEncoder().encode(base);
  if (bytes.length <= 900) return base;
  return new TextDecoder().decode(bytes.slice(0, 900)).replace(/�$/, "");
}

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = guard(request, env);
  if (denied instanceof Response) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Fichier illisible" }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Aucun fichier reçu" }, 400);

  try {
    const limit = Math.min(await maxUploadBytes(env), SINGLE_PART_MAX);
    if (file.size > limit) {
      return json({ error: `Fichier trop lourd : ${mb(file.size)} Mo, maximum ${mb(limit)} Mo.` }, 413);
    }

    const name = safeName(file.name);
    const upload = await notion<{ id: string }>(env, "/file_uploads", {
      method: "POST",
      body: {
        mode: "single_part",
        filename: name,
        content_type: file.type || "application/octet-stream",
      },
    });

    const body = new FormData();
    body.append("file", file, name);
    const sent = await notionSend<{ status: string }>(env, `/file_uploads/${upload.id}/send`, body);
    if (sent.status !== "uploaded") return json({ error: "Notion n'a pas accepté le fichier", retry: true }, 502);

    // An upload that is never attached to a page expires on Notion's side
    // after an hour; the note is sent within seconds of this.
    return json({ id: upload.id, name, size: file.size });
  } catch (error) {
    return fail(error);
  }
};
