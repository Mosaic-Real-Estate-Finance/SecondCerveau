// Client for the /api/outlook routes. The shapes here are the contracts in
// specs/001-outlook-vers-notion/contracts/, and nothing else talks to them.
//
// A Microsoft bearer token authenticates every call: it proves who the caller
// is. Without Entra configured (local development), the panel still sends the
// x-user-email header it used before the bearer existed — but since feature
// 002 the server no longer reads that header (constitution 2.0.0, IV), so such
// a panel is answered 401. Configure Entra to test against the API.

export type ThreadMessage = {
  id: string;
  receivedAt: string;
  from: { name: string; address: string };
  text: string;
  attachmentNames: string[];
  /** Panel only: never sent to the server, which lists names from attachmentNames. */
  attachments?: AttachmentRef[];
  /**
   * The Graph ids of the other copies of this same mail, folded away by
   * `unique()`. Sent so the server can still recognise a « Dernier message »
   * mark that names one of them — see src/outlook/unique.ts.
   */
  copyIds?: string[];
};

/** A mail attachment as Graph describes it, before anything is downloaded. */
export type AttachmentRef = {
  /** The Graph id of the copy that carries it. */
  messageId: string;
  id: string;
  name: string;
  /** As Graph announces it, which can exceed the content by a few KB. */
  size: number;
  /** A file, a mail attached to the mail, or a link to a file in the cloud. */
  kind: "file" | "item" | "reference";
  contentType: string;
  inline: boolean;
};

/** A file already handed to Notion, waiting for the note that attaches it. */
export type UploadedFile = { id: string; name: string; size: number };

export type SkippedFile = { name: string; reason: string };

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
  filesAdded?: number;
  filesSkipped?: SkippedFile[];
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

// The attachments' metadata stays in the panel: the server writes the names
// from attachmentNames, and the files arrive separately, already uploaded.
const bare = (messages: ThreadMessage[]) => messages.map(({ attachments: _, ...message }) => message);

export const createNote = (input: {
  conversationId: string;
  contactIds: string[];
  messages: ThreadMessage[];
  files?: { id: string; name: string }[];
}) =>
  call<NoteWritten>("/api/outlook/notes", {
    method: "POST",
    body: JSON.stringify({ ...input, messages: bare(input.messages) }),
  });

export const enrichNote = (input: {
  noteId: string;
  conversationId: string;
  sinceMessageId: string | null;
  contactIds: string[];
  messages: ThreadMessage[];
  files?: { id: string; name: string }[];
}) =>
  call<NoteWritten>("/api/outlook/notes", {
    method: "PATCH",
    body: JSON.stringify({ ...input, messages: bare(input.messages) }),
  });

// ---- Attachments (feature 003) ---------------------------------------------

/** The per file limit of the Notion workspace, in bytes. */
export const uploadLimit = () =>
  call<{ maxBytes: number }>("/api/outlook/attachments").then((body) => body.maxBytes);

/**
 * Has the server fetch one attachment from Microsoft and hand it to Notion.
 *
 * The file never passes through here: a request body is capped at 4.5 MB on
 * the server, so what travels is the reference and the Graph token that lets
 * the server read it. See specs/003-outlook-mobile-pieces-jointes/research.md B.
 */
export const importAttachment = (ref: AttachmentRef, graphToken: string) =>
  call<UploadedFile | { skipped: true; reason: string }>("/api/outlook/attachments", {
    method: "POST",
    headers: { "X-Graph-Token": graphToken },
    body: JSON.stringify({ messageId: ref.messageId, attachmentId: ref.id }),
  });
