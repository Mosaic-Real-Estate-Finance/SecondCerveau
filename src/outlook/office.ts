// The only file that talks to Office.js.
//
// office.js is loaded by a script tag in outlook.html, from the Microsoft CDN,
// and is never bundled — Microsoft does not support a local copy, and it is
// also the reason the isolation headers must not reach /outlook: COEP
// require-corp would block it outright.
//
// The surface used here is small enough to declare, which keeps @types/office-js
// out of the build. Everything is read, nothing is written back to the mailbox.

type Recipient = { displayName?: string; emailAddress?: string };

type Item = {
  itemId?: string;
  conversationId?: string;
  subject?: string;
  from?: Recipient;
  sender?: Recipient;
  to?: Recipient[];
  cc?: Recipient[];
  body?: { getAsync(type: string, cb: (result: { status: string; value?: string }) => void): void };
};

type OfficeGlobal = {
  onReady(cb?: () => void): Promise<unknown>;
  context: {
    requirements: { isSetSupported(name: string, version?: string): boolean };
    mailbox?: {
      item?: Item | null;
      userProfile?: { emailAddress?: string; displayName?: string };
      addHandlerAsync(event: unknown, handler: () => void, cb?: (r: { status: string }) => void): void;
    };
  };
  EventType: { ItemChanged: unknown };
  AsyncResultStatus: { Succeeded: string };
  CoercionType: { Text: string };
};

declare const Office: OfficeGlobal | undefined;

const office = () => (typeof Office === "undefined" ? null : Office);

/** Resolves once Office is ready. False when the page is opened outside Outlook. */
export async function ready(): Promise<boolean> {
  const api = office();
  if (!api) return false;
  await api.onReady();
  return true;
}

/**
 * Whether this Outlook can do nested app authentication.
 *
 * It cannot be declared in an add-in manifest, so it has to be asked at
 * runtime — and it has to be asked at all, because the legacy Exchange tokens
 * that used to be the fallback were turned off across all tenants in October
 * 2025. Without this requirement set there is no way in, and the panel says so
 * instead of failing halfway.
 */
export function supportsNaa(): boolean {
  try {
    return office()?.context.requirements.isSetSupported("NestedAppAuth", "1.1") ?? false;
  } catch {
    return false;
  }
}

export type MailContext = {
  itemId: string;
  conversationId: string;
  subject: string;
  /** Sender first, then recipients, then copies. Duplicates are kept: the caller folds them. */
  participants: { name: string; address: string }[];
};

const person = (recipient: Recipient | undefined) =>
  recipient?.emailAddress ? [{ name: recipient.displayName ?? "", address: recipient.emailAddress }] : [];

/** The mail currently open, or null when there is none (no reading pane). */
export function readItem(): MailContext | null {
  const item = office()?.context.mailbox?.item;
  if (!item) return null;
  return {
    itemId: item.itemId ?? "",
    conversationId: item.conversationId ?? "",
    subject: item.subject ?? "",
    participants: [
      ...person(item.from ?? item.sender),
      ...(item.to ?? []).flatMap(person),
      ...(item.cc ?? []).flatMap(person),
    ],
  };
}

/** The signed-in collaborator, as Outlook knows them. */
export const currentUser = () => office()?.context.mailbox?.userProfile?.emailAddress ?? "";

/**
 * Whether the body can be read at all.
 *
 * A protected or encrypted mail answers with a failure, and the panel has to
 * say the content is unreadable rather than send an empty note.
 */
export function bodyReadable(): Promise<boolean> {
  const api = office();
  const item = api?.context.mailbox?.item;
  if (!api || !item?.body) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      item.body!.getAsync(api.CoercionType.Text, (result) =>
        resolve(result.status === api.AsyncResultStatus.Succeeded && typeof result.value === "string"),
      );
    } catch {
      resolve(false);
    }
  });
}

/** Fires when the user selects another mail while the panel is pinned. */
export function onItemChanged(handler: () => void): void {
  const api = office();
  const mailbox = api?.context.mailbox;
  if (!api || !mailbox) return;
  try {
    mailbox.addHandlerAsync(api.EventType.ItemChanged, handler);
  } catch {
    // Not every host supports pinning; the panel then only ever shows one mail.
  }
}
