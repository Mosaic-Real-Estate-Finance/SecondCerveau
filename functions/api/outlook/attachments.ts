import { decodeJwt } from "jose";
import { contentTypeOf, fileNameOf, kindOf, technical, type GraphAttachment } from "../../_lib/attachments.js";
import { fail, guard, json, maxUploadBytes, type Handler } from "../../_lib/notion.js";
import { megabytes, UploadRefused, uploadToNotion } from "../../_lib/upload.js";

// One mail attachment, from Microsoft to Notion, without passing through the
// panel.
//
// A Vercel function takes at most 4.5 MB of request body, so the panel cannot
// send the file. It sends the reference instead, with the delegated Graph
// token it already holds to read the thread, and this route fetches the bytes
// itself. Why that token rather than an on-behalf-of exchange or an
// application permission: specs/003-outlook-mobile-pieces-jointes/research.md
// B-2. In short, it needs no new permission and no secret, and it can read
// nothing the user could not already read.
//
// The Graph token authenticates nothing here. Who is calling is decided by
// guard(), on the API token, exactly as for every other route; the Graph token
// is only the key to the user's own mailbox, used for one request and never
// kept or logged.
//
// Neither the name nor the content of a file is ever logged (constitution,
// principle VIII).

const GRAPH = "https://graph.microsoft.com/v1.0";

type Body = { messageId?: string; attachmentId?: string };

type Claims = { oid?: string; tid?: string };

/** A file that will not be imported, and why, in the panel's own words. */
const skipped = (reason: string) => json({ skipped: true, reason });

/**
 * Whether the Graph token was issued to the same person as the API token.
 *
 * Both are decoded without verification, and that is enough. The API token
 * was verified by guard() a moment ago. The Graph token is Graph's to verify:
 * a forged one would be refused by the very next call, so claims that get
 * past that call are genuine. What this adds is the one check Graph cannot
 * make — that the mailbox being read belongs to the caller.
 */
function sameAccount(apiToken: string, graphToken: string): boolean {
  try {
    const api = decodeJwt(apiToken) as Claims;
    const graph = decodeJwt(graphToken) as Claims;
    return Boolean(api.oid && api.tid && api.oid === graph.oid && api.tid === graph.tid);
  } catch {
    return false;
  }
}

const bearerOf = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
};

/** The bytes, refused as soon as they exceed the limit rather than after. */
async function download(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer> | "too-big"> {
  const announced = Number(response.headers.get("content-length"));
  if (announced > limit) {
    await response.body?.cancel();
    return "too-big";
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return "too-big";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

// ---- GET: the per file limit, so the panel can mark what is too heavy ------

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  try {
    return json({ maxBytes: await maxUploadBytes(env) });
  } catch (error) {
    return fail(error);
  }
};

// ---- POST: import one attachment -----------------------------------------

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;

  const graphToken = request.headers.get("x-graph-token")?.trim() ?? "";
  const body = (await request.json().catch(() => ({}))) as Body;
  const messageId = body.messageId?.trim();
  const attachmentId = body.attachmentId?.trim();
  if (!messageId || !attachmentId) return json({ error: "Pièce jointe non précisée" }, 400);
  if (!graphToken) return json({ error: "Accès au courrier manquant" }, 400);
  if (!sameAccount(bearerOf(request), graphToken)) {
    return json({ error: "Ce jeton Microsoft n'est pas le tien." }, 403);
  }

  const at = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const headers = { Authorization: `Bearer ${graphToken}` };

  try {
    // Metadata first, selected: a bare GET on a file attachment carries the
    // whole file in base64, which is exactly what this route exists to avoid.
    const meta = await fetch(`${at}?$select=name,size,contentType,isInline`, { headers });
    if (!meta.ok) {
      const reason =
        meta.status === 404
          ? "Pièce jointe introuvable dans la boîte mail."
          : meta.status === 401 || meta.status === 403
            ? "Accès au courrier refusé."
            : "Lecture de la pièce jointe impossible.";
      return json({ error: reason, retry: meta.status >= 500 }, meta.status >= 500 ? 502 : 400);
    }
    const attachment = (await meta.json()) as GraphAttachment;

    if (technical(attachment)) return skipped("Image intégrée ou fichier technique.");
    if (kindOf(attachment) === "reference") return skipped("Lien vers un fichier en ligne, pas un fichier joint.");

    const limit = await maxUploadBytes(env);
    const content = await fetch(`${at}/$value`, { headers });
    if (!content.ok) {
      return json({ error: "Téléchargement de la pièce jointe impossible.", retry: content.status >= 500 }, 502);
    }
    const bytes = await download(content, limit);
    if (bytes === "too-big") {
      return skipped(`Fichier trop lourd : ${megabytes(attachment.size ?? limit + 1)}, maximum ${megabytes(limit)}.`);
    }
    if (!bytes.byteLength) return skipped("Fichier vide.");

    const name = fileNameOf(attachment);
    const type = contentTypeOf(attachment);
    const id = await uploadToNotion(env, new Blob([bytes], { type }), name, type);

    // Valid for an hour, unattached: the note is written seconds after.
    return json({ id, name, size: bytes.byteLength });
  } catch (error) {
    if (error instanceof UploadRefused) return json({ error: error.message, retry: true }, 502);
    return fail(error);
  }
};
