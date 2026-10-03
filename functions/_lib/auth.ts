import { createRemoteJWKSet, jwtVerify } from "jose";
import { findUser, type User } from "./users";
import type { Env } from "./notion";

// Who is calling, for every route of both tools.
//
// Two paths, and they are not equals:
//
//  - The dictation sends `x-user-email`. An address on the allowlist is enough
//    to get in, which names the author of a note but proves nothing. It is
//    what the PWA has always done, and it keeps working.
//
//  - The Outlook add-in sends a Microsoft access token. That one is proof: the
//    signature, the issuer, the audience and the tenant are all checked here.
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

/** Why a bearer was refused, so the caller can say something useful in French. */
export type AuthFailure = "token" | "tenant" | "user";

export type Identity = { user: User } | { failure: AuthFailure };

type Claims = {
  tid?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
};

async function fromBearer(token: string, env: Env): Promise<Identity> {
  const tenants = tenantsOf(env);
  for (const tenant of tenants) {
    for (const issuer of ISSUERS) {
      try {
        const { payload } = await jwtVerify(token, jwks(tenant), {
          issuer: issuer(tenant),
          audience: env.ENTRA_API_CLIENT_ID,
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
      } catch {
        // Wrong tenant, wrong issuer variant, bad signature, expired: try the
        // next combination and decide once they are all exhausted.
      }
    }
  }
  return { failure: tenants.length ? "tenant" : "token" };
}

/**
 * The caller, or why they were refused.
 *
 * A bearer that is present but invalid is never rescued by the header path.
 * Otherwise sending a forged bearer alongside an `x-user-email` would skip the
 * whole verification, which is worse than having no verification at all.
 */
export async function identify(request: Request, env: Env): Promise<Identity> {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  if (bearer) {
    if (!bearerPathEnabled(env)) return { failure: "token" };
    return fromBearer(bearer, env);
  }

  const user = findUser(request.headers.get("x-user-email"));
  return user ? { user } : { failure: "user" };
}

export const AUTH_MESSAGES: Record<AuthFailure, string> = {
  token: "Session Microsoft invalide, reconnectez-vous.",
  tenant: "Ce compte n'appartient pas à une organisation autorisée.",
  user: "Adresse non autorisée",
};

/** The domains whose addresses are Mosaic's own, and never attached to a note. */
export const internalDomains = (env: Env) =>
  (env.INTERNAL_DOMAINS ?? "mosaicfin.com")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
