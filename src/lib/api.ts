// Client for the functions in /functions.
//
// Identity travels in an HttpOnly session cookie, opened with a code received
// by email (feature 002). The browser sends it on its own with every request
// to this origin; no script can read it, this one included. What is kept in
// localStorage below is only the greeting — the first name — and a hint that
// a session was opened on this device.

export type Contact = {
  id: string;
  name: string;
  company: string;
  role: string;
  types: string[];
  phones: string[];
  createdAt: string;
};

export type Company = { id: string; name: string; type: string };

export type Session = { email: string; firstName: string };

const SESSION_KEY = "mosaic-session";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retry: boolean,
    /** The whole error body, for the routes that send more than a sentence. */
    public data: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

export const session = {
  get(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(value: Session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch {
      // Private mode: the address then lasts for the session only.
    }
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing stored.
    }
  },
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        // A multipart body carries its own content type, boundary and all,
        // and the runtime is the only thing that knows the boundary.
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError("Pas de connexion réseau", 0, true);
  }
  // A 200 that is not JSON is not a success: the service worker can hand
  // back the app shell for a request it should have let through, and an
  // empty object then flows into the screens as missing fields and takes
  // the page down. It is treated as the failure it is.
  const body = await response.text().catch(() => "");
  let data: Record<string, unknown> | null = null;
  try {
    const parsed = body ? JSON.parse(body) : {};
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new ApiError(
      (data?.error as string) ?? `Erreur ${response.status}`,
      response.status,
      (data?.retry as boolean) ?? response.status >= 500,
      data,
    );
  }
  if (!data) throw new ApiError("Réponse inattendue du serveur", response.status, true);
  return data as T;
}

// ---- Sign-in ------------------------------------------------------------------

/** Sends a code if the address is allowed. The answer is the same either way. */
export const requestCode = (email: string) =>
  call<{ ok: true }>("/api/auth/code", { method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase() }) });

/** A right code opens the session: the cookie comes back with the answer. */
export const verifyCode = (email: string, code: string) =>
  call<Session>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.replace(/\s+/g, "") }),
  });

/** Read at every launch; a valid session comes back extended for 90 days. */
export const fetchSession = () => call<Session>("/api/session");

export const logout = () => call<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" });

export const fetchContacts = () =>
  call<{ contacts: Contact[]; rollup: boolean; typeOptions: string[] }>("/api/contacts");

export const fetchCompanies = () => call<{ companies: Company[]; typeOptions: string[] }>("/api/companies");

export type NewCompany = { name: string; description?: string; site?: string; type?: string; address?: string };

// Returns the company itself, so the form can select the one it just made.
export const createCompany = (company: NewCompany) =>
  call<Company>("/api/companies", { method: "POST", body: JSON.stringify(company) });

export type NewContact = {
  name: string;
  role?: string;
  phones: { country: string; dial: string; number: string }[];
  types: string[];
  companyId?: string;
  newCompany?: { name: string; description?: string; site?: string; type?: string; address?: string };
};

export const createContact = (contact: NewContact) =>
  call<{ contact: Contact }>("/api/contacts", { method: "POST", body: JSON.stringify(contact) });

/** A document or photo already uploaded to Notion, waiting to be attached. */
export type NoteFile = { id: string; name: string; size: number };

// Sent as soon as the user picks it, so the upload happens while the
// transcription is still running rather than after it. Notion drops an
// upload that is never attached to a page after an hour, which is far
// longer than the few seconds between this and the note being sent.
export function uploadFile(file: File) {
  const body = new FormData();
  body.append("file", file, file.name);
  return call<NoteFile>("/api/files", { method: "POST", body });
}

export const createNotionNote = (note: {
  clientId: string;
  transcript: string;
  contactId: string | null;
  // Local calendar day, YYYY-MM-DD: a note dictated at 1 am stays on that day.
  recordedAt: string;
  files: { id: string; name: string }[];
}) => call<{ id: string; url: string }>("/api/notes", { method: "POST", body: JSON.stringify(note) });

// Contacts picked on this device, most recent first, so they sit at the top.
const RECENT_KEY = "mosaic-recent-contacts";

export const recentContacts = {
  get(): string[] {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
      return [];
    }
  },
  push(id: string) {
    const next = [id, ...recentContacts.get().filter((other) => other !== id)].slice(0, 5);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Recents are a convenience; losing them is harmless.
    }
  },
};

// ---- Read AI : « À valider » ---------------------------------------------------

export type ContactRef = { id: string; name: string; company: string };
export type CompanyRef = { id: string; name: string };

export type Decision =
  | { action: "attach" | "create"; contactId: string; name: string; by: string; at: string }
  | { action: "exclude"; by: string; at: string };

export type PendingPerson = {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  companies: CompanyRef[];
  candidates: ContactRef[];
  decision?: Decision;
};

export type ReviewItem = {
  id: string;
  key: string;
  kind: "new" | "complete";
  status: "pending" | "error";
  stage?: "process" | "close";
  error?: string;
  createdAt: string;
  noteId?: string;
  noteUrl?: string;
  meeting: {
    sessionId: string;
    title: string;
    start: string;
    end: string | null;
    owner: { name: string; email: string | null } | null;
    summary: string;
    reportUrl: string | null;
    turns: number;
  };
  authors: { email: string; notionUserId: string }[];
  recognized: ({ email: string } & ContactRef)[];
  people: PendingPerson[];
};

export type Closed = { closed: true; noteUrl: string | null };

export const fetchReview = () =>
  call<{ items: ReviewItem[]; excluded: string[]; count: number }>("/api/readai/items");

export const fetchReviewCount = () => call<{ count: number }>("/api/readai/items?count=1");

export type DecideBody =
  | { action: "attach"; contactId: string }
  | { action: "create"; contact: NewContact }
  | { action: "exclude" };

export const decidePerson = (itemId: string, email: string, decision: DecideBody) =>
  call<{ item: ReviewItem } | Closed>("/api/readai/decide", {
    method: "POST",
    body: JSON.stringify({ itemId, email, ...decision }),
  });

export const ignoreCall = (itemId: string) =>
  call<Closed>("/api/readai/ignore", { method: "POST", body: JSON.stringify({ itemId }) });

export const retryCall = (itemId: string) =>
  call<Closed | { outcome: string }>("/api/readai/retry", { method: "POST", body: JSON.stringify({ itemId }) });

export const removeExcluded = (email: string) =>
  call<{ excluded: string[] }>("/api/readai/excluded", {
    method: "POST",
    body: JSON.stringify({ email, action: "remove" }),
  });

export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  call<{ ok: true }>("/api/readai/push", { method: "POST", body: JSON.stringify({ subscription }) });

export const deletePushSubscription = (endpoint: string) =>
  call<{ ok: true }>("/api/readai/push", { method: "DELETE", body: JSON.stringify({ endpoint }) });
