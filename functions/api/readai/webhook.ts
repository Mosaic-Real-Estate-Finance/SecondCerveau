import { createHash } from "node:crypto";
import { later } from "../../_lib/background.js";
import { json, type Handler } from "../../_lib/notion.js";
import { parseMeeting, verifySignature } from "../../_lib/readai/payload.js";
import { processMeeting } from "../../_lib/readai/process.js";
import { KEYS } from "../../_lib/readai/queue.js";
import { redis } from "../../_lib/redis.js";

// The door Read AI knocks on (brief §4.1, contracts/webhook.md).
//
// Read AI is a server, not a person, so no session here: the HMAC signature of
// the raw body is the whole of the authentication. Filtering on a domain or an
// address would prove nothing — Read AI publishes no list, and the origin of
// a server request is whatever the sender says it is.
//
// The answer goes back as soon as the signature and the replay check are done.
// Read AI documents no timeout, retries anything above 299, and stops the
// webhook for good after 25 consecutive failures: a long meeting must never
// turn into a retry, and a retry into a duplicate. The work continues after
// the response; what fails there becomes a visible item, not an error code.

const THIRTY_DAYS = 30 * 24 * 3600;

export const onRequestPost: Handler = async ({ request, env }) => {
  // Raw bytes first, before any parsing: the signature covers them exactly.
  const raw = Buffer.from(await request.arrayBuffer());
  if (!env.READAI_WEBHOOK_SECRET) console.error("[readai] READAI_WEBHOOK_SECRET absent : tout est refusé");
  if (!verifySignature(raw, request.headers.get("x-read-signature"), env.READAI_WEBHOOK_SECRET)) {
    return json({ error: "Signature invalide" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    // Signed, so it is Read AI's; unreadable, so a retry would be too.
    console.error("[readai] payload signé mais illisible");
    return json({ ok: true, ignored: "payload" });
  }

  if (payload.trigger !== "meeting_end") return json({ ok: true, ignored: "trigger" });

  const requestId =
    typeof payload.request_id === "string" && payload.request_id
      ? payload.request_id
      : createHash("sha256").update(raw).digest("hex");

  try {
    const first = await redis(env).set(KEYS.request(requestId), 1, { nx: true, ex: THIRTY_DAYS });
    if (first !== "OK") return json({ ok: true, duplicate: true });
  } catch {
    // Without the store there is no deduplication and nowhere to keep the
    // call. A retry from Read AI is worth more than a report lost.
    console.error("[readai] stockage indisponible à la réception");
    return json({ error: "Stockage indisponible" }, 503);
  }

  const meeting = parseMeeting(payload);
  if (!meeting) {
    console.error("[readai] meeting_end sans session_id");
    return json({ ok: true, ignored: "payload" });
  }

  later("readai", processMeeting(env, meeting));
  return json({ ok: true });
};
