import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { redis } from "./redis.js";
import type { Env } from "./notion.js";

// The PWA's sign-in: a six digit code sent by email, then a session in an
// HttpOnly cookie (brief §10, contracts/auth.md, research G-1).
//
// It replaces the x-user-email header, which named a person and proved
// nothing — with a public repository, knowing an address from users.ts was
// enough. The app now shows client meetings and creates contacts, so the door
// asks for proof (constitution 2.0.0, principle IV).

export const COOKIE = "mosaic_session";
const MAX_AGE = 90 * 24 * 3600;
const CODE_TTL = 10 * 60;
const CODE_TRIES = 5;
const SENDS_PER_HOUR = 5;

const KEYS = {
  code: (email: string) => `auth:code:${email}`,
  cool: (email: string) => `auth:cool:${email}`,
  hour: (email: string) => `auth:hour:${email}`,
  revoked: (jti: string) => `auth:revoked:${jti}`,
};

export class SessionConfigError extends Error {}

function secret(env: Env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 16) throw new SessionConfigError("SESSION_SECRET absent");
  return env.SESSION_SECRET;
}

const key = (env: Env) => new TextEncoder().encode(secret(env));

export const cleanEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// ---- Codes ------------------------------------------------------------------

/** Stored hashed, keyed with the server secret and bound to the address. */
const hashOf = (env: Env, email: string, code: string) =>
  createHmac("sha256", secret(env)).update(`${email}:${code}`).digest("hex");

export type CodeRequest = { ok: true; code: string | null } | { ok: false; status: 429; error: string };

/**
 * Applies the send limits and, for an allowed address, makes a code.
 *
 * The limits run for every address, allowed or not, so that the answer —
 * including a 429 — never tells who is on the list. The caller sends the
 * mail only when a code comes back.
 */
export async function requestCode(env: Env, email: string, allowed: boolean): Promise<CodeRequest> {
  const store = redis(env);
  const cool = await store.set(KEYS.cool(email), 1, { nx: true, ex: 60 });
  if (cool !== "OK") return { ok: false, status: 429, error: "Attendez une minute avant de redemander un code." };
  const sent = await store.incr(KEYS.hour(email));
  if (sent === 1) await store.expire(KEYS.hour(email), 3600);
  if (sent > SENDS_PER_HOUR) return { ok: false, status: 429, error: "Trop de codes demandés, réessayez dans une heure." };
  if (!allowed) return { ok: true, code: null };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await store.set(KEYS.code(email), { hash: hashOf(env, email, code), tries: 0 }, { ex: CODE_TTL });
  return { ok: true, code };
}

/**
 * True once, for the right code within ten minutes. Five wrong tries and the
 * code is gone: the sixth attempt meets nothing to guess.
 */
export async function checkCode(env: Env, email: string, code: string): Promise<boolean> {
  const store = redis(env);
  const held = await store.get<{ hash: string; tries: number }>(KEYS.code(email));
  if (!held || !/^\d{6}$/.test(code)) return false;
  const given = Buffer.from(hashOf(env, email, code));
  const right = given.length === held.hash.length && timingSafeEqual(given, Buffer.from(held.hash));
  if (right) {
    // Single use: deleted before the session is even signed.
    await store.del(KEYS.code(email));
    return true;
  }
  const tries = held.tries + 1;
  if (tries >= CODE_TRIES) await store.del(KEYS.code(email));
  else await store.set(KEYS.code(email), { ...held, tries }, { keepTtl: true });
  return false;
}

// ---- Sessions ---------------------------------------------------------------

export type SessionClaims = { email: string; jti: string; exp: number };

/** A fresh token for 90 days, and the cookie that carries it. */
export async function issueSession(env: Env, email: string): Promise<string> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key(env));
  // HttpOnly: no script of the page can read it. SameSite=Strict: no other
  // site can make the browser send it. Max-Age, not a session cookie: the
  // installed app on iOS keeps a persistent cookie across launches and drops
  // a session one (research G-2).
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE}`;
}

export const clearedCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export function cookieToken(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * The session the request carries, or null. Throws only when the store is
 * unreachable — an outage must not read as "signed out", or every phone
 * would drop its session at once.
 */
export async function readSession(env: Env, request: Request): Promise<SessionClaims | null> {
  const token = cookieToken(request);
  if (!token) return null;
  let claims: SessionClaims;
  try {
    const { payload } = await jwtVerify(token, key(env), { algorithms: ["HS256"] });
    if (!payload.sub || !payload.jti || !payload.exp) return null;
    claims = { email: payload.sub, jti: payload.jti, exp: payload.exp };
  } catch (error) {
    if (error instanceof SessionConfigError) throw error;
    return null;
  }
  const revoked = await redis(env).exists(KEYS.revoked(claims.jti));
  return revoked ? null : claims;
}

/** Revoked until the token would have expired anyway, then forgotten. */
export async function revoke(env: Env, claims: SessionClaims) {
  const ttl = Math.max(1, claims.exp - Math.floor(Date.now() / 1000));
  await redis(env).set(KEYS.revoked(claims.jti), 1, { ex: ttl });
}
