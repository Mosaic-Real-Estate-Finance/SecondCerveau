import { later } from "../_lib/background.js";
import { mailEnabled, sendCode } from "../_lib/mail.js";
import { guard, json, type Handler } from "../_lib/notion.js";
import {
  checkCode,
  cleanEmail,
  clearedCookie,
  issueSession,
  readSession,
  requestCode,
  revoke,
  validEmail,
} from "../_lib/session.js";
import { findUser } from "../_lib/users.js";

// /api/auth/code, /api/auth/verify, /api/auth/logout — one function for the
// three (research E-1: the Hobby plan stops at twelve). contracts/auth.md.
// /api/auth/stt-token rides on the same function for the same reason: api/
// already holds twelve files.

const actionOf = (request: Request) => new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";

const unavailable = () => json({ error: "Service momentanément indisponible, réessayez.", retry: true }, 503);

async function code(request: Request, env: Parameters<Handler>[0]["env"]) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = cleanEmail(body.email);
  if (!validEmail(email)) return json({ error: "Adresse invalide" }, 400);
  const user = findUser(email);
  if (user && !mailEnabled(env)) console.error("[auth] SMTP non configuré : aucun code ne peut partir");
  let result;
  try {
    result = await requestCode(env, email, Boolean(user && mailEnabled(env)));
  } catch {
    return unavailable();
  }
  if (!result.ok) return json({ error: result.error }, result.status);
  // Sent after the response, so its duration does not tell an allowed
  // address from one that is not.
  if (result.code) later("auth", sendCode(env, email, result.code));
  return json({ ok: true });
}

async function verify(request: Request, env: Parameters<Handler>[0]["env"]) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
  const email = cleanEmail(body.email);
  const given = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const user = findUser(email);
  let right = false;
  try {
    right = user ? await checkCode(env, email, given) : false;
  } catch {
    return unavailable();
  }
  // One sentence for every failure: wrong, expired, used up, or not on the list.
  if (!user || !right) return json({ error: "Code incorrect ou expiré." }, 401);
  const response = json({ email: user.email, firstName: user.firstName });
  response.headers.append("Set-Cookie", await issueSession(env, user.email));
  return response;
}

async function logout(request: Request, env: Parameters<Handler>[0]["env"]) {
  try {
    const session = await readSession(env, request);
    if (session) await revoke(env, session);
  } catch {
    return unavailable();
  }
  const response = json({ ok: true });
  response.headers.append("Set-Cookie", clearedCookie());
  return response;
}

// ---- Real-time transcription key ------------------------------------------
//
// The dictation streams its audio straight to Soniox from the phone. The
// account key cannot ship to a browser, so the browser asks for a temporary
// one here, signed in like every other route, and opens the WebSocket with it.
// https://soniox.com/docs/guides/temporary-api-keys
//
// The key only has to open the stream: a stream already open outlives it.
// It is single use and short, and the client asks for a fresh one on every
// reconnection.

const SONIOX_WS_DEFAULT = "wss://stt-rt.soniox.com/transcribe-websocket";
const SONIOX_MODEL_DEFAULT = "stt-rt-v5";
const KEY_SECONDS = 60;

// The region is chosen by the WebSocket URL alone, so moving to the EU is one
// variable: Soniox names its hosts in pairs, stt-rt.<region>.soniox.com for
// the stream and api.<region>.soniox.com for the REST API, and a key minted in
// one region is only valid in that region. https://soniox.com/docs/data-residency
const restHostOf = (wsUrl: string) => {
  const host = new URL(wsUrl).host;
  return host.startsWith("stt-rt.") ? `api.${host.slice("stt-rt.".length)}` : "api.soniox.com";
};

async function sttToken(request: Request, env: Parameters<Handler>[0]["env"]) {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  if (!env.SONIOX_API_KEY) return json({ error: "Transcription non configurée sur le serveur" }, 500);
  const wsUrl = env.SONIOX_WS_URL || SONIOX_WS_DEFAULT;
  let response: Response;
  try {
    response = await fetch(`https://${restHostOf(wsUrl)}/v1/auth/temporary-api-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SONIOX_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: KEY_SECONDS, single_use: true }),
    });
  } catch (error) {
    console.error(`[stt-token] Soniox injoignable : ${(error as Error).message}`);
    return json({ error: "Service de transcription injoignable", retry: true }, 502);
  }
  const body = (await response.json().catch(() => ({}))) as { api_key?: string; expires_at?: string; message?: string };
  if (!response.ok || !body.api_key) {
    // Never the account key, and never Soniox's body as is: only its status.
    console.error(`[stt-token] Soniox a répondu ${response.status}`);
    return json({ error: "Clé de transcription refusée", retry: response.status >= 500 }, 502);
  }
  return json({
    apiKey: body.api_key,
    expiresAt: body.expires_at ?? null,
    wsUrl,
    model: env.SONIOX_MODEL || SONIOX_MODEL_DEFAULT,
  });
}

export const onRequestPost: Handler = async ({ request, env }) => {
  switch (actionOf(request)) {
    case "code":
      return code(request, env);
    case "verify":
      return verify(request, env);
    case "logout":
      return logout(request, env);
    case "stt-token":
      return sttToken(request, env);
    default:
      return json({ error: "Route inconnue" }, 404);
  }
};
