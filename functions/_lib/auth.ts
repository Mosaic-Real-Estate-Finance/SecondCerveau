import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify } from "jose";
import { findUser, type User } from "./users.js";
import { readSession } from "./session.js";
import type { Env } from "./notion.js";

// Who is calling, for every route of the PWA and of the Outlook add-in. (The
// Read AI webhook is a server and proves itself by its signature instead.)
//
// Two paths, and both are proof (constitution 2.0.0, principle IV):
//
//  - The PWA carries a session cookie, opened with a code received by email
//    (./session.ts). The `x-user-email` header it used to send named a person
//    and proved nothing; it is no longer read at all.
//
//  - The Outlook add-in sends a Microsoft access token. The signature, the
//    issuer, the audience and the tenant are all checked here.
//
// The add-in has no choice in the matter. The legacy Exchange identity and
// callback tokens it would otherwise have used were turned off across every
// Microsoft 365 tenant in October 2025, so nested app authentication is the
// only way in — there is no fallback to fall back to.
//
// The token carried is deliberately an ACCESS token for this API's own scope,
// never the ID token: Microsoft calls passing an ID token to a service to
// authorize access a security anti-pattern, and it is right. An access token
// carries the same identity claims anyway.

const ISSUERS = [
  // v2.0 tokens, which is what MSAL issues.
  (tenant: string) => `https://login.microsoftonline.com/${tenant}/v2.0`,
  // v1.0, in case an app registration is configured for it.
  (tenant: string) => `https://sts.windows.net/${tenant}/`,
];

// One JWKS fetcher per tenant, kept for the life of the isolate. jose caches
// the keys itself and refetches on an unknown key id, so a key rotation costs
// one extra request rather than a wave of 401s.
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(tenant: string) {
  const held = keys.get(tenant);
  if (held) return held;
  const made = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`),
  );
  keys.set(tenant, made);
  return made;
}

const tenantsOf = (env: Env) =>
  (env.ENTRA_TENANT_IDS ?? "")
    .split(",")
    .map((tenant) => tenant.trim())
    .filter(Boolean);

export const bearerPathEnabled = (env: Env) => Boolean(env.ENTRA_API_CLIENT_ID) && tenantsOf(env).length > 0;

// Both spellings of the audience are accepted, and that is not laxity.
//
// A v2.0 token issued for a custom scope carries the resource's client id as
// `aud`; a v1.0 token carries its Application ID URI, `api://<client-id>`.
// Which one the app registration issues depends on its
// `accessTokenAcceptedVersion`, a field nobody looks at until tokens start
// being rejected. Both forms name the same registration, so both are checked.
const audiencesOf = (env: Env) => [env.ENTRA_API_CLIENT_ID!, `api://${env.ENTRA_API_CLIENT_ID}`];

/** Why a bearer was refused, so the caller can say something useful in French. */
export type AuthFailure = "token" | "tenant" | "expired" | "user" | "session" | "unavailable";

export type Identity = { user: User } | { failure: AuthFailure };

type Claims = {
  tid?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
};

// Why every attempt failed, used only to choose the sentence shown to the
// user. A wrong signature and a wrong tenant are the same 401, but they are
// not the same advice: one means reconnect, the other means ask an
// administrator, and sending someone to the wrong one wastes their afternoon.
//
// The payload is decoded WITHOUT verification to tell them apart. That is safe
// because nothing here grants anything — the only thing read is which message
// to print. No claim from this decode ever reaches `findUser`.
function refusal(token: string, tenants: string[], expired: boolean): AuthFailure {
  if (expired) return "expired";
  try {
    const tid = (decodeJwt(token) as Claims).tid;
    if (tid && !tenants.includes(tid)) return "tenant";
  } catch {
    // Not even a JWT.
  }
  return "token";
}

async function fromBearer(token: string, env: Env): Promise<Identity> {
  const tenants = tenantsOf(env);
  let expired = false;

  for (const tenant of tenants) {
    for (const issuer of ISSUERS) {
      try {
        const { payload } = await jwtVerify(token, jwks(tenant), {
          issuer: issuer(tenant),
          audience: audiencesOf(env),
        });
        const claims = payload as Claims;
        // A token signed by one allowed tenant but issued for another is not
        // the same thing as a token from an allowed tenant.
        if (claims.tid && claims.tid !== tenant) continue;
        const email = claims.preferred_username ?? claims.upn ?? claims.email ?? "";
        const user = findUser(email);
        // Identity proved, authorisation not granted: the address still has to
        // be one of ours.
        return user ? { user } : { failure: "user" };
      } catch (error) {
        if (error instanceof joseErrors.JWTExpired) expired = true;
        // Wrong tenant, wrong issuer variant, bad signature, expired: try the
        // next combination and decide once they are all exhausted.
      }
    }
  }
  return { failure: refusal(token, tenants, expired) };
}

/**
 * The caller, or why they were refused.
 *
 * A bearer that is present but invalid is never rescued by the cookie path:
 * one forged credential must not be excused by another being present.
 */
export async function identify(request: Request, env: Env): Promise<Identity> {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (bearer) {
    if (!bearerPathEnabled(env)) return { failure: "token" };
    return fromBearer(bearer, env);
  }

  let session;
  try {
    session = await readSession(env, request);
  } catch {
    // The store that holds revocations is unreachable, or the server has no
    // SESSION_SECRET. Not the caller's fault, and not a reason to sign every
    // phone out: the guard answers 503, which the app retries.
    return { failure: "unavailable" };
  }
  if (!session) return { failure: "session" };
  // Still on the list: removing someone from users.ts closes their sessions.
  const user = findUser(session.email);
  return user ? { user } : { failure: "user" };
}

export const AUTH_MESSAGES: Record<AuthFailure, string> = {
  token: "Session Microsoft invalide, reconnectez-vous.",
  expired: "Session Microsoft expirée, reconnectez-vous.",
  tenant: "Ce compte n'appartient pas à une organisation autorisée.",
  user: "Adresse non autorisée",
  session: "Session expirée, reconnectez-vous.",
  unavailable: "Service momentanément indisponible, réessayez.",
};

/** The domains whose addresses are Mosaic's own, and never attached to a note. */
export const internalDomains = (env: Env) =>
  (env.INTERNAL_DOMAINS ?? "mosaicfin.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
