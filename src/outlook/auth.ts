import {
  createNestablePublicClientApplication,
  type AuthenticationResult,
  type IPublicClientApplication,
} from "@azure/msal-browser";
import { chooseEntraConfig, type EntraConfig, type EntraEnv } from "./entra-config";

// Signing in, from inside Outlook.
//
// Nested app authentication: Outlook itself holds the session, and MSAL asks
// the host for a token rather than opening its own window. There is no
// fallback here on purpose — the legacy Exchange identity and callback tokens
// that used to serve as one were turned off across every Microsoft 365 tenant
// in October 2025, so an Outlook too old for NAA simply cannot sign in, and
// the panel says so instead of failing halfway.
//
// Two tokens, two resources:
//   - one for this add-in's own API, which the server verifies;
//   - one for Microsoft Graph, to read the thread.
// They are separate requests because they are separate audiences. A token for
// Graph proves nothing to our server, and vice versa.
//
// What never travels is the ID token. Microsoft calls passing it to a service
// to authorize access a security anti-pattern, and it is right: an access
// token carries the same identity claims and can actually be validated.

const GRAPH_SCOPE = "https://graph.microsoft.com/Mail.Read";

// Two app registrations, Mosaic's and the test tenant's: which one is decided
// once per session from the mailbox address, before MSAL exists. See
// ./entra-config.ts.
let config: EntraConfig | null = null;

// Named one by one: Vite replaces each with its value at build time, where
// handing over import.meta.env whole would inline every VITE_ variable.
const ENV: EntraEnv = {
  VITE_ENTRA_CLIENT_ID: import.meta.env.VITE_ENTRA_CLIENT_ID,
  VITE_ENTRA_AUTHORITY: import.meta.env.VITE_ENTRA_AUTHORITY,
  VITE_ENTRA_API_SCOPE: import.meta.env.VITE_ENTRA_API_SCOPE,
  VITE_ENTRA_CLIENT_ID_TEST: import.meta.env.VITE_ENTRA_CLIENT_ID_TEST,
  VITE_ENTRA_AUTHORITY_TEST: import.meta.env.VITE_ENTRA_AUTHORITY_TEST,
  VITE_ENTRA_API_SCOPE_TEST: import.meta.env.VITE_ENTRA_API_SCOPE_TEST,
  VITE_ENTRA_TEST_DOMAINS: import.meta.env.VITE_ENTRA_TEST_DOMAINS,
};

/**
 * Picks the registration for this mailbox. Called once Office is ready, with
 * the address Outlook reports (main.tsx). Ignored once MSAL has been created:
 * a nestable client stays bound to the client id it was built with.
 */
export function selectEntraConfig(email: string | null | undefined): EntraConfig {
  if (!client) config = chooseEntraConfig(email, ENV);
  return active();
}

/** The chosen registration; the main one if nothing chose before the first use. */
const active = () => (config ??= chooseEntraConfig(null, ENV));

/** False when no app registration is configured: the panel then says so and calls nothing. */
export const configured = () => Boolean(active().clientId && active().apiScope);

export class AuthError extends Error {
  constructor(
    message: string,
    /** True when the host asked the user something and they declined or closed it. */
    public interactionNeeded = false,
  ) {
    super(message);
  }
}

let client: Promise<IPublicClientApplication> | null = null;

function app() {
  const { clientId, authority } = active();
  client ??= createNestablePublicClientApplication({
    // No redirect URI here: with nested app authentication the host brokers
    // the response, and the `brk-multihub://<origin>` SPA redirect declared on
    // the app registration is what it matches against. Both registrations
    // need it.
    //
    // The localStorage cache is keyed by client id, so the two registrations
    // never read each other's tokens.
    auth: { clientId, authority },
    cache: { cacheLocation: "localStorage" },
  });
  return client;
}

// MSAL always returns an id, a refresh and an access token, and it requires at
// least one resource scope in the request or no access token comes back at
// all. Both calls below therefore name their resource explicitly.
async function tokenFor(scope: string): Promise<string> {
  if (!configured()) throw new AuthError("Application Microsoft non configurée.");
  const instance = await app();
  const request = { scopes: [scope] };

  try {
    const silent: AuthenticationResult = await instance.acquireTokenSilent(request);
    if (silent.accessToken) return silent.accessToken;
  } catch {
    // Expected the first time, and whenever consent or a claims challenge is
    // required: fall through to the interactive path, which inside Outlook is
    // the host's own dialog.
  }

  try {
    const result = await instance.acquireTokenPopup(request);
    if (!result.accessToken) throw new AuthError("Aucun jeton d'accès renvoyé.");
    return result.accessToken;
  } catch (error) {
    const message = (error as Error)?.message ?? "";
    // The host's consent window was closed, or a policy refused it. Saying
    // which is impossible from here; saying that it was asked is not.
    throw new AuthError(
      /user_cancelled|popup_window_error|interaction_required|consent/i.test(message)
        ? "Connexion Microsoft annulée. Réessaye pour autoriser l'accès."
        : "Connexion Microsoft impossible.",
      true,
    );
  }
}

/** For our own routes. The server verifies this one. */
export const apiToken = () => tokenFor(active().apiScope);

/** For Microsoft Graph, to read the thread. */
export const graphToken = () => tokenFor(GRAPH_SCOPE);

/** The signed-in account, as Entra knows it. Null before the first token. */
export async function signedInEmail(): Promise<string | null> {
  if (!configured()) return null;
  const instance = await app();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  return account?.username ?? null;
}
