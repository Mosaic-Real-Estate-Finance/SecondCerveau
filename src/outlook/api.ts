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
};

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
  phones?: { country: string; number: string }[];
  companyId?: string;
  companyName?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retry: boolean,
    /** Set when a note exists despite the failure, so the panel can show it. */
    public noteUrl?: string,
    /** Set on 409: the mark the note actually carries now. */
    public lastMessageId?: string | null,
  ) {
    super(message);
  }
}

let bearer: string | null = null;
let fallbackEmail = "";

/** Called once MSAL has a token for this add-in's own API scope. */
export const setBearer = (token: string | null) => {
  bearer = token;
};

/** The address Outlook reports, used only while the bearer path is off. */
export const setFallbackEmail = (email: string) => {
  fallbackEmail = email;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  };
  if (!response.ok) {
    throw new ApiError(
      body.error ?? "Erreur inattendue",
      response.status,
      body.retry ?? response.status >= 500,
      body.noteUrl,
      body.lastMessageId,
    );
  }
  return body as T;
}

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
