// Client for the /api/outlook routes. The shapes here are the contracts in
// specs/001-outlook-vers-notion/contracts/, and nothing else talks to them.
//
// Two identities can authenticate a call. A Microsoft bearer token proves who
// the caller is; the x-user-email header only names them, and is what the
// dictation has always used. The bearer is set once authentication lands
// (phase 7) — until then the header lets the panel be built and tested.

export type ThreadMessage = {
  id: string;
  receivedAt: string;
  from: { name: string; address: string };
  text: string;
  attachmentNames: string[];
};

export type MatchedContact = { id: string; name: string; company: string };

export type MatchResult = {
  matched: Record<string, MatchedContact>;
  unknown: string[];
  /** Addresses carried by more than one contact: a flaw of the base, shown not hidden. */
  ambiguous?: string[];
  /** Options of the Type column, for the creation form. */
  typeOptions: string[];
};

export type Company = { id: string; name: string; type: string };

export type ExistingNote = { id: string; url: string; lastMessageId: string | null };

export type NoteWritten = {
  id: string;
  url: string;
  messagesAdded: number;
  /** True when the blocks had to be appended before the Notion template landed. */
  templateTimedOut?: boolean;
  duplicate?: boolean;
};

export type NewContact = {
  name: string;
  email: string;
  role?: string;
  types?: string[];
  phones?: { country: string; dial?: string; number: string }[];
  companyId?: string;
  /** Same shape the dictation's form sends, so the server path is identical. */
  newCompany?: { name: string };
};

/** Why a 401 came back. The panel words these itself; see AUTH_COPY. */
export type AuthCode = "token" | "expired" | "tenant" | "user";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retry: boolean,
    /** Set when a note exists despite the failure, so the panel can show it. */
    public noteUrl?: string,
    /** Set on 409: the mark the note actually carries now. */
    public lastMessageId?: string | null,
    /** Set on 401. */
    public code?: AuthCode,
  ) {
    super(message);
  }
}

/**
 * The panel's own wording for the refusals.
 *
 * The server sends a sentence too, but it is the dictation's — same routes,
 * and the dictation addresses its reader as "vous". Rather than have one of
 * the two apps speak in the other's register, the 401 carries a code and each
 * writes its own.
 */
export const AUTH_COPY: Record<AuthCode, string> = {
  token: "Ta session Microsoft n'est plus valide. Reconnecte-toi.",
  expired: "Ta session Microsoft a expiré. Reconnecte-toi.",
  tenant: "Ce compte n'appartient pas à une organisation autorisée.",
  user: "Ton adresse n'est pas autorisée. Écris à Théo pour qu'il t'ajoute.",
};

// A provider rather than a stored token: MSAL renews silently, and asking it
// per call means a panel left open across a token expiry still works. Caching
// the string here would make it stale exactly when nobody is watching.
let provider: (() => Promise<string>) | null = null;
let fallbackEmail = "";

export const setTokenProvider = (fn: (() => Promise<string>) | null) => {
  provider = fn;
};

/** The address Outlook reports, used only while the bearer path is off. */
export const setFallbackEmail = (email: string) => {
  fallbackEmail = email;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const bearer = provider ? await provider() : null;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : { "x-user-email": fallbackEmail }),
        ...init.headers,
      },
    });
  } catch {
    // Distinguishing the network from Notion is what US4 asks for: the user
    // waits differently depending on which one is down.
    throw new ApiError("Pas de réseau. La saisie est conservée.", 0, true);
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    retry?: boolean;
    noteUrl?: string;
    lastMessageId?: string | null;
    code?: AuthCode;
  };
  if (!response.ok) {
    const code = body.code;
    throw new ApiError(
      (code && AUTH_COPY[code]) || body.error || "Erreur inattendue",
      response.status,
      body.retry ?? response.status >= 500,
      body.noteUrl,
      body.lastMessageId,
      code,
    );
  }
  return body as T;
}

export const listCompanies = () =>
  call<{ companies: Company[]; typeOptions: string[] }>("/api/companies");

export const matchContacts = (addresses: string[]) =>
  call<MatchResult>("/api/outlook/contacts/match", {
    method: "POST",
    body: JSON.stringify({ addresses }),
  });

export const createContact = (contact: NewContact) =>
  call<MatchedContact>("/api/outlook/contacts", {
    method: "POST",
    body: JSON.stringify(contact),
  });

export const findNote = (conversationId: string) =>
  call<{ note: ExistingNote | null }>(
    `/api/outlook/notes?conversationId=${encodeURIComponent(conversationId)}`,
  ).then((body) => body.note);

export const createNote = (input: {
  conversationId: string;
  contactIds: string[];
  messages: ThreadMessage[];
}) => call<NoteWritten>("/api/outlook/notes", { method: "POST", body: JSON.stringify(input) });

export const enrichNote = (input: {
  noteId: string;
  conversationId: string;
  sinceMessageId: string | null;
  contactIds: string[];
  messages: ThreadMessage[];
}) => call<NoteWritten>("/api/outlook/notes", { method: "PATCH", body: JSON.stringify(input) });
