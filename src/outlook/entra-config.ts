// Which Entra app registration the taskpane signs in with.
//
// The add-in serves two tenants at once: Mosaic's, in production, and Théo's
// test tenant. Each has its own app registration — an app registration lives
// in one tenant, and a multi-tenant one would need Mosaic's admin to consent
// to an app owned elsewhere. So the panel holds two configurations and picks
// one from the mailbox it is opened in, before MSAL is created: a nestable
// client is bound to one client id for the whole session.
//
// The test configuration is optional. Without the _TEST variables, or for any
// address outside the test domains, the panel behaves exactly as it did with a
// single registration.
//
// Pure on purpose (the variables are passed in, not read from import.meta.env)
// so scripts/test-outlook.mjs can run it under Node.

export type EntraEnv = {
  VITE_ENTRA_CLIENT_ID?: string;
  VITE_ENTRA_AUTHORITY?: string;
  VITE_ENTRA_API_SCOPE?: string;
  VITE_ENTRA_CLIENT_ID_TEST?: string;
  VITE_ENTRA_AUTHORITY_TEST?: string;
  VITE_ENTRA_API_SCOPE_TEST?: string;
  VITE_ENTRA_TEST_DOMAINS?: string;
};

export type EntraConfig = {
  clientId: string;
  authority: string;
  apiScope: string;
  /** Which registration: the test tenant's, or the main one. */
  flavour: "main" | "test";
};

/** `common` lets the host pick the user's tenant; the server's allowlist decides. */
export const DEFAULT_AUTHORITY = "https://login.microsoftonline.com/common";

const clean = (value: string | undefined) => (value ?? "").trim();

/** "gouman.fr, @G0uman.onmicrosoft.com" → ["gouman.fr", "g0uman.onmicrosoft.com"] */
export const testDomains = (env: EntraEnv) =>
  clean(env.VITE_ENTRA_TEST_DOMAINS)
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);

/** The domain of an address, lower case. Empty when there is none. */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * The registration for this mailbox.
 *
 * The test one only when the address is in a test domain AND that
 * registration is fully configured; anything less falls back to the main one,
 * which is the behaviour from before this choice existed. Exact domain match:
 * a subdomain of a test domain is not the test tenant.
 */
export function chooseEntraConfig(email: string | null | undefined, env: EntraEnv): EntraConfig {
  const testReady = Boolean(clean(env.VITE_ENTRA_CLIENT_ID_TEST) && clean(env.VITE_ENTRA_API_SCOPE_TEST));
  const domain = domainOf(email ?? "");
  if (testReady && domain && testDomains(env).includes(domain)) {
    return {
      clientId: clean(env.VITE_ENTRA_CLIENT_ID_TEST),
      authority: clean(env.VITE_ENTRA_AUTHORITY_TEST) || DEFAULT_AUTHORITY,
      apiScope: clean(env.VITE_ENTRA_API_SCOPE_TEST),
      flavour: "test",
    };
  }
  return {
    clientId: clean(env.VITE_ENTRA_CLIENT_ID),
    authority: clean(env.VITE_ENTRA_AUTHORITY) || DEFAULT_AUTHORITY,
    apiScope: clean(env.VITE_ENTRA_API_SCOPE),
    flavour: "main",
  };
}
