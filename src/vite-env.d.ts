// Types des variables d'environnement exposées au navigateur.
// Fusionne avec celles de vite/client, déclarées dans tsconfig.app.json.

interface ImportMetaEnv {
  /** Microsoft Entra, read by the Outlook taskpane. Public identifiers. */
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_ENTRA_AUTHORITY?: string;
  readonly VITE_ENTRA_API_SCOPE?: string;
  /** The test tenant's registration, used for addresses in VITE_ENTRA_TEST_DOMAINS. */
  readonly VITE_ENTRA_CLIENT_ID_TEST?: string;
  readonly VITE_ENTRA_AUTHORITY_TEST?: string;
  readonly VITE_ENTRA_API_SCOPE_TEST?: string;
  /** Comma separated mailbox domains that sign in with the test registration. */
  readonly VITE_ENTRA_TEST_DOMAINS?: string;
  /** The Notion notes database, so the panel can offer a way into it. Public. */
  readonly VITE_NOTION_NOTES_DB?: string;
  /** Web Push application server key. Public by design. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

