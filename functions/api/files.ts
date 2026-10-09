import { fail, guard, json, maxUploadBytes, type Handler } from "../_lib/notion.js";
import { mb, safeName, SINGLE_PART_MAX, UploadRefused, uploadToNotion } from "../_lib/upload.js";

// A document or a photo attached to a dictation, uploaded to Notion and
// handed back as a reference the note creation puts in its Fichier column.
//
// The upload itself lives in ../_lib/upload.ts, shared with the Outlook
// add-in. This route keeps its own ceiling of 20 MiB: the file arrives in the
// body of the request, and a photo from a phone is far below it anyway.

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
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
    const id = await uploadToNotion(env, file, name, file.type);

    // An upload that is never attached to a page expires on Notion's side
    // after an hour; the note is sent within seconds of this.
    return json({ id, name, size: file.size });
  } catch (error) {
    if (error instanceof UploadRefused) return json({ error: error.message, retry: true }, 502);
    return fail(error);
  }
};
