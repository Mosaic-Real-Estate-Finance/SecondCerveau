// Types des variables d'environnement exposées au navigateur.
// Fusionne avec celles de vite/client, déclarées dans tsconfig.app.json.

interface ImportMetaEnv {
  /** Transcription model, read by the dictation. */
  readonly VITE_WHISPER_MODEL?: string;
  /** Microsoft Entra, read by the Outlook taskpane. Public identifiers. */
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_ENTRA_AUTHORITY?: string;
  readonly VITE_ENTRA_API_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

