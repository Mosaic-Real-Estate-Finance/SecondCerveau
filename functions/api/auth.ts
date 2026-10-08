import { later } from "../_lib/background.js";
import { mailEnabled, sendCode } from "../_lib/mail.js";
import { json, type Handler } from "../_lib/notion.js";
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

export const onRequestPost: Handler = async ({ request, env }) => {
  switch (actionOf(request)) {
    case "code":
      return code(request, env);
    case "verify":
      return verify(request, env);
    case "logout":
      return logout(request, env);
    default:
      return json({ error: "Route inconnue" }, 404);
  }
};
