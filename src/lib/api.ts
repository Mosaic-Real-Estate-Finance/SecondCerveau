// Client for the Pages Functions in /functions. The address is typed once per
// device; it names the author of every note that device sends.

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
    current = value;
  },
  clear() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // Nothing stored.
    }
    current = null;
  },
};

let current: Session | null = session.get();

async function call<T>(path: string, init: RequestInit = {}, email = current?.email): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        // A multipart body carries its own content type, boundary and all,
        // and the runtime is the only thing that knows the boundary.
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        "x-user-email": email ?? "",
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
    );
  }
  if (!data) throw new ApiError("Réponse inattendue du serveur", response.status, true);
  return data as T;
}

export const openSession = (email: string) =>
  call<Session>("/api/session", { method: "POST", body: "{}" }, email.trim().toLowerCase());

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
