// The thread, from Microsoft Graph.
//
// Two things here are not obvious and both come from Graph itself:
//
//  - `uniqueBody` is the message without the quoted history of the ones before
//    it. Using `body` would repeat every earlier message inside every later
//    one, and a ten-message thread would land in Notion fifty-five times over.
//
//  - `$orderby` cannot be combined with this `$filter`: Graph requires every
//    ordered property to appear in the filter first. So the thread comes back
//    unordered and is sorted here.

import type { ThreadMessage } from "./api";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE = 50;

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };

type GraphMessage = {
  id: string;
  receivedDateTime?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  uniqueBody?: { content?: string };
  body?: { content?: string };
  hasAttachments?: boolean;
  attachments?: { name?: string }[];
};

const namesOf = (message: GraphMessage) =>
  (message.attachments ?? []).map((file) => file.name ?? "").filter(Boolean);

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Plain text from Graph still carries the soft wrapping of the original mail
// and, on HTML mails converted to text, long runs of blank lines from tables
// and signatures. Collapsing them is what keeps the note readable.
const tidy = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

const convert = (message: GraphMessage): ThreadMessage => ({
  id: message.id,
  receivedAt: message.receivedDateTime ?? new Date().toISOString(),
  from: {
    name: message.from?.emailAddress?.name ?? message.sender?.emailAddress?.name ?? "",
    address: message.from?.emailAddress?.address ?? message.sender?.emailAddress?.address ?? "",
  },
  text: tidy(message.uniqueBody?.content ?? message.body?.content ?? ""),
  attachmentNames: namesOf(message),
});

/**
 * Every message of a conversation, oldest first.
 *
 * `onProgress` is called as pages arrive, so a long thread shows movement
 * instead of a frozen panel.
 */
export async function fetchThread(
  token: string,
  conversationId: string,
  onProgress?: (count: number) => void,
): Promise<ThreadMessage[]> {
  const select = "id,receivedDateTime,from,sender,uniqueBody,hasAttachments";
  // Expanding the attachments with only their name costs nothing and spares a
  // request per message: the files themselves are never downloaded.
  let url =
    `${GRAPH}/me/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'` +
    `&$select=${select}&$expand=attachments($select=name)&$top=${PAGE}`;
  const messages: ThreadMessage[] = [];
  const missingNames: string[] = [];

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Gives both body and uniqueBody as text rather than HTML.
        Prefer: 'outlook.body-content-type="text"',
      },
    });
    if (!response.ok) {
      const detail = response.status === 403 ? "Accès au courrier refusé." : "Lecture du fil impossible.";
      throw new GraphError(detail, response.status);
    }
    const page = (await response.json()) as { value?: GraphMessage[]; "@odata.nextLink"?: string };
    for (const message of page.value ?? []) {
      messages.push(convert(message));
      // An expand that came back empty on a message that has attachments: ask
      // for its names on their own rather than list none.
      if (message.hasAttachments && !namesOf(message).length) missingNames.push(message.id);
    }
    onProgress?.(messages.length);
    url = page["@odata.nextLink"] ?? "";
  }

  for (const id of missingNames) {
    const names = await fetchAttachmentNames(token, id);
    const message = messages.find((one) => one.id === id);
    if (message) message.attachmentNames = names;
  }

  // Graph would not sort this query (see the note at the top of the file).
  messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  return messages;
}

/** Names only, for a message whose expand came back without them. */
export async function fetchAttachmentNames(token: string, messageId: string): Promise<string[]> {
  const response = await fetch(`${GRAPH}/me/messages/${messageId}/attachments?$select=name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const page = (await response.json()) as { value?: { name?: string }[] };
  return (page.value ?? []).map((file) => file.name ?? "").filter(Boolean);
}
