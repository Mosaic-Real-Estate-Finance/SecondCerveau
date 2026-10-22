import { later } from "../_lib/background.js";
import { MANIFEST } from "../_lib/manifest.js";
import { isOutageReason, reportOutage, resolveOutage, resolvePage } from "../_lib/stt-outage.js";
import { guard, json, type Handler } from "../_lib/notion.js";
import {
  checkCode,
  cleanEmail,
  clearedCookie,
  createHandoff,
  handoffShape,
  type HandoffKind,
  issueSession,
  readSession,
  redeemHandoff,
  requestCode,
  revoke,
  validEmail,
} from "../_lib/session.js";
import { findUser } from "../_lib/users.js";
import { onRequestPost as feedback } from "./feedback.js";
import { onRequestPost as track } from "./track.js";

// /api/auth/code, /api/auth/verify, /api/auth/logout — one function for the
// three (research E-1: the Hobby plan stops at twelve). contracts/auth.md.
// /api/auth/stt-token, /handoff, /redeem and GET /manifest ride on the same
// function for the same reason: api/ already holds twelve files.

const actionOf = (request: Request) => new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";

const unavailable = () => json({ error: "Service momentanément indisponible, réessayez.", retry: true }, 503);

async function code(request: Request, env: Parameters<Handler>[0]["env"]) {
  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email = cleanEmail(body.email);
  if (!validEmail(email)) return json({ error: "Adresse invalide" }, 400);
  // Loaded here only: nodemailer and the mail's logo are the heaviest part of
  // this function, and no other action of it sends a mail.
  const { mailEnabled, sendCode } = await import("../_lib/mail.js");
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
  // `outage` tells the app this is the account's problem, not the user's
  // nor the network's: it reports it (/stt-alert) instead of retrying.
  if (!env.SONIOX_API_KEY) return json({ error: "Transcription non configurée sur le serveur", outage: "config" }, 500);
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
    if (response.status >= 500) return json({ error: "Clé de transcription refusée", retry: true }, 502);
    return json({ error: "Clé de transcription refusée", outage: response.status === 402 ? "balance" : "key" }, 502);
  }
  return json({
    apiKey: body.api_key,
    expiresAt: body.expires_at ?? null,
    wsUrl,
    model: env.SONIOX_MODEL || SONIOX_MODEL_DEFAULT,
  });
}

// ---- From the computer to the phone -----------------------------------------
//
// /handoff: a signed-in device asks for a sign-in link — the computer, to show
// as a QR code; Safari on an iPhone, for the app it is about to install.
// /redeem: the device that opened it gets its session. GET /manifest: the
// install manifest, whose start address carries the install token, so that
// the app installed on an iPhone — which does not share Safari's cookies —
// signs itself in on its first launch. See session.ts.

const PARAM: Record<HandoffKind, string> = { qr: "connexion", install: "installer" };

async function handoff(request: Request, env: Parameters<Handler>[0]["env"]) {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const body = (await request.json().catch(() => ({}))) as { install?: unknown };
  const kind: HandoffKind = body.install === true ? "install" : "qr";
  try {
    const { token, expiresIn } = await createHandoff(env, denied.user.email, kind);
    // The QR code's token rides in the fragment, which no request carries:
    // it never reaches a server log. The install token cannot: it has to be
    // part of the address iOS starts the installed app on.
    const path = kind === "qr" ? `/#${PARAM.qr}=${token}` : `/?${PARAM.install}=${token}`;
    const url = new URL(path, new URL(request.url).origin).href;
    return json({ url, expiresIn });
  } catch {
    return unavailable();
  }
}

async function redeem(request: Request, env: Parameters<Handler>[0]["env"]) {
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  if (!handoffShape(body.token)) return json({ error: "Lien de connexion invalide." }, 400);
  let held: Awaited<ReturnType<typeof redeemHandoff>>;
  try {
    held = await redeemHandoff(env, body.token);
  } catch {
    return unavailable();
  }
  // Still on the list: a token outlives nothing that users.ts takes away.
  const user = held ? findUser(held.email) : undefined;
  // Which step of the trip from the computer worked, for the logs — never the token.
  console.info(`handoff redeem: ${held ? held.kind : "spent or expired"}${held && !user ? " (unknown user)" : ""}`);
  if (!user) {
    return json(
      {
        error:
          held?.kind === "install" || !held
            ? "Ce lien de connexion a expiré. Connectez-vous avec un code, ou scannez un nouveau QR code."
            : "Ce QR code a expiré. Affichez-en un nouveau depuis l'ordinateur.",
      },
      401,
    );
  }
  const response = json({ email: user.email, firstName: user.firstName });
  response.headers.append("Set-Cookie", await issueSession(env, user.email));
  return response;
}

function manifest(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  // Same app, same identity: only where it starts changes. The token is not
  // checked here; it is checked when the app spends it.
  const start = handoffShape(token) ? `/?${PARAM.install}=${token}` : "/";
  return new Response(JSON.stringify({ ...MANIFEST, start_url: start }), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}

// /stt-alert: the app met a transcription outage only the account owner can
// fix (credit, key, configuration); the owner is mailed once. /stt-resolved:
// the link of that mail, which tells the users once it is fixed. Its token
// is the proof, as a code is for /verify. See _lib/stt-outage.ts.
async function sttAlert(request: Request, env: Parameters<Handler>[0]["env"]) {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  if (!isOutageReason(body.reason)) return json({ error: "Motif inconnu" }, 400);
  try {
    await reportOutage(env, denied.user, body.reason, new URL(request.url).origin);
  } catch {
    return unavailable();
  }
  return json({ ok: true });
}

async function sttResolved(request: Request, env: Parameters<Handler>[0]["env"]) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("t");
  return resolveOutage(env, typeof token === "string" ? token : null);
}

export const onRequestGet: Handler = async ({ request, env }) => {
  switch (actionOf(request)) {
    case "manifest":
      return manifest(request);
    case "stt-resolved":
      return resolvePage(env, new URL(request.url).searchParams.get("t"));
    default:
      return json({ error: "Route inconnue" }, 404);
  }
};

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
    case "handoff":
      return handoff(request, env);
    case "redeem":
      return redeem(request, env);
    case "stt-alert":
      return sttAlert(request, env);
    case "stt-resolved":
      return sttResolved(request, env);
    // Usage events (./track.ts). Here rather than in a function of its own:
    // the Hobby plan deploys twelve functions at most, and all are taken.
    case "track":
      return track({ request, env });
    // The app's feedback form (./feedback.ts), for the same reason.
    case "feedback":
      return feedback({ request, env });
    default:
      return json({ error: "Route inconnue" }, 404);
  }
};
