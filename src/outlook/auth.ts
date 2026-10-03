import {
  createNestablePublicClientApplication,
  type AuthenticationResult,
  type IPublicClientApplication,
} from "@azure/msal-browser";

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

const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID ?? "";
const AUTHORITY = import.meta.env.VITE_ENTRA_AUTHORITY ?? "https://login.microsoftonline.com/common";
const API_SCOPE = import.meta.env.VITE_ENTRA_API_SCOPE ?? "";
const GRAPH_SCOPE = "https://graph.microsoft.com/Mail.Read";

/** False when no app registration is configured: the panel then uses the fallback header. */
export const configured = () => Boolean(CLIENT_ID && API_SCOPE);

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
  client ??= createNestablePublicClientApplication({
    // No redirect URI here: with nested app authentication the host brokers
    // the response, and the `brk-multihub://<origin>` SPA redirect declared on
    // the app registration is what it matches against.
    auth: { clientId: CLIENT_ID, authority: AUTHORITY },
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
export const apiToken = () => tokenFor(API_SCOPE);

/** For Microsoft Graph, to read the thread. */
export const graphToken = () => tokenFor(GRAPH_SCOPE);

/** The signed-in account, as Entra knows it. Null before the first token. */
export async function signedInEmail(): Promise<string | null> {
  if (!configured()) return null;
  const instance = await app();
  const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
  return account?.username ?? null;
}
