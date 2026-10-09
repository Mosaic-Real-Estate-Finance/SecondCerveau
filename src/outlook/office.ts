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
    diagnostics?: { platform?: string };
    ui?: {
      closeContainer?(): void;
      openBrowserWindow?(url: string): void;
    };
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
 * Whether there is an Outlook mailbox behind this page at all.
 *
 * office.js loads perfectly well from its CDN in an ordinary browser tab, and
 * `Office.onReady` resolves there too — so the mere presence of the library
 * says nothing. What distinguishes a host is the mailbox. Without this check
 * the panel mistakes a browser tab for an Outlook too old to sign in, and
 * tells the reader to update a version of Outlook they are not running.
 */
export function inMailbox(): boolean {
  try {
    return Boolean(office()?.context?.mailbox);
  } catch {
    return false;
  }
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

/**
 * The mail currently open, waited for instead of asked once.
 *
 * A taskpane can already be running while Outlook is still loading the
 * metadata of the item in the reading pane, and `mailbox.item` is null in that
 * gap. Asked a single time, a panel opened on a perfectly ordinary mail settles
 * on "no mail" and stays there, which is the one state the reader cannot tell
 * apart from a broken add-in.
 */
export async function awaitItem(tries = 12, every = 150): Promise<MailContext | null> {
  for (let attempt = 0; ; attempt++) {
    const mail = readItem();
    if (mail?.conversationId) return mail;
    if (attempt >= tries) return mail;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
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

// ---- What the host lets us do ----------------------------------------------
// Both of these exist on some hosts and not others, and calling one that is
// missing throws inside Office's own code. They are therefore asked for, never
// assumed: the panel hides the button rather than offering one that fails.

/** Whether this host can close the taskpane from inside it. */
export function canClose(): boolean {
  try {
    return typeof office()?.context?.ui?.closeContainer === "function";
  } catch {
    return false;
  }
}

export function closePanel(): void {
  try {
    office()?.context?.ui?.closeContainer?.();
  } catch {
    // Nothing to do: the user closes it the way they opened it.
  }
}

/**
 * Opens a link outside the taskpane.
 *
 * `openBrowserWindow` is the host's own way out and the only one that reliably
 * leaves the iframe; plain `window.open` is the fallback for hosts without it,
 * and for the page opened in an ordinary tab. Only http(s) goes through the
 * host: it refuses anything else, and a custom scheme has to be navigated to
 * directly.
 */
export function openExternal(url: string): void {
  const http = /^https?:/i.test(url);
  const host = office()?.context?.ui?.openBrowserWindow;
  // Asked by requirement set, not by the function's presence: Microsoft only
  // ships OpenBrowserWindowApi on classic Outlook for Windows and on Mac. On
  // iOS and Android it is not supported at all (research 003 A-3), and there
  // the plain window.open below is what takes the link out of the panel.
  if (http && typeof host === "function" && supports("OpenBrowserWindowApi", "1.1")) {
    try {
      host(url);
      return;
    } catch {
      // Fall through to the window the browser gives us.
    }
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    // Nothing left to try.
  }
}

function supports(name: string, version: string): boolean {
  try {
    return office()?.context.requirements.isSetSupported(name, version) ?? false;
  } catch {
    return false;
  }
}

/**
 * Whether this is Outlook on a phone or a tablet (feature 003).
 *
 * The taskpane is then the whole screen, there is no pinning, and a link has
 * no desktop app to be handed to.
 */
export function isMobile(): boolean {
  try {
    const platform = office()?.context?.diagnostics?.platform ?? "";
    return platform === "iOS" || platform === "Android";
  } catch {
    return false;
  }
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
