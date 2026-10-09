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
//
// A third, which is why `unique()` exists: this query spans the whole mailbox,
// folders included, so one mail can come back several times under several ids.
// See src/outlook/unique.ts.

import type { AttachmentRef, ThreadMessage } from "./api";
import { unique } from "./unique";

const GRAPH = "https://graph.microsoft.com/v1.0";
const PAGE = 50;

type GraphRecipient = { emailAddress?: { name?: string; address?: string } };

type GraphMessage = {
  id: string;
  internetMessageId?: string;
  isDraft?: boolean;
  receivedDateTime?: string;
  from?: GraphRecipient;
  sender?: GraphRecipient;
  uniqueBody?: { content?: string };
  body?: { content?: string };
  hasAttachments?: boolean;
  attachments?: GraphAttachment[];
};

type GraphAttachment = {
  "@odata.type"?: string;
  id?: string;
  name?: string;
  size?: number;
  contentType?: string;
  isInline?: boolean;
};

// The fields the panel needs to decide what to import (feature 003), asked for
// in the same expand as the names: still one request for the whole thread.
const ATTACHMENT_FIELDS = "id,name,size,isInline,contentType";

const kindOf = (attachment: GraphAttachment): AttachmentRef["kind"] => {
  const type = (attachment["@odata.type"] ?? "").toLowerCase();
  if (type.endsWith("itemattachment")) return "item";
  if (type.endsWith("referenceattachment")) return "reference";
  return "file";
};

/** Every attachment of a message, tied to the copy that actually carries it. */
const refsOf = (messageId: string, attachments: GraphAttachment[] | undefined): AttachmentRef[] =>
  (attachments ?? [])
    .filter((file) => file.id)
    .map((file) => ({
      messageId,
      id: file.id!,
      name: file.name ?? "",
      size: file.size ?? 0,
      kind: kindOf(file),
      contentType: file.contentType ?? "",
      inline: Boolean(file.isInline),
    }));

/** A message on its way through `unique()`, before the id of a mail is dropped. */
type Candidate = ThreadMessage & { internetMessageId?: string };

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

const convert = (message: GraphMessage): Candidate => ({
  id: message.id,
  internetMessageId: message.internetMessageId,
  receivedAt: message.receivedDateTime ?? new Date().toISOString(),
  from: {
    name: message.from?.emailAddress?.name ?? message.sender?.emailAddress?.name ?? "",
    address: message.from?.emailAddress?.address ?? message.sender?.emailAddress?.address ?? "",
  },
  text: tidy(message.uniqueBody?.content ?? message.body?.content ?? ""),
  attachmentNames: namesOf(message),
  attachments: refsOf(message.id, message.attachments),
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
  const select = "id,internetMessageId,isDraft,receivedDateTime,from,sender,uniqueBody,hasAttachments";
  // Expanding the attachments' metadata costs nothing and spares a request per
  // message. The files themselves are never downloaded here: the server
  // fetches the ones the user keeps (feature 003).
  let url =
    `${GRAPH}/me/messages?$filter=conversationId eq '${encodeURIComponent(conversationId)}'` +
    `&$select=${select}&$expand=attachments($select=${ATTACHMENT_FIELDS})&$top=${PAGE}`;
  const messages: Candidate[] = [];
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
      // A draft is a mail nobody has received. It belongs to the thread in
      // Outlook and to nothing at all in a record of exchanges.
      if (message.isDraft) continue;
      messages.push(convert(message));
      // An expand that came back empty on a message that has attachments: ask
      // for its names on their own rather than list none.
      if (message.hasAttachments && !namesOf(message).length) missingNames.push(message.id);
    }
    // The count the panel shows is the count of mails, not of copies: it would
    // otherwise announce "5 messages identifiés" and then offer to add 3.
    onProgress?.(unique(messages).length);
    url = page["@odata.nextLink"] ?? "";
  }

  for (const id of missingNames) {
    const attachments = await fetchAttachments(token, id);
    const message = messages.find((one) => one.id === id);
    if (message) {
      message.attachmentNames = namesOf({ id, attachments });
      message.attachments = refsOf(id, attachments);
    }
  }

  // Graph would not sort this query (see the note at the top of the file).
  // Sorting comes first because `unique()` keeps the oldest copy of a mail,
  // and "oldest" has to mean something before anything is folded.
  messages.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  // The id of a mail is Graph's business, not Notion's: it leaves here.
  return unique(messages).map(({ internetMessageId: _, ...message }) => message);
}

/** Metadata only, for a message whose expand came back without it. */
async function fetchAttachments(token: string, messageId: string): Promise<GraphAttachment[]> {
  const response = await fetch(`${GRAPH}/me/messages/${messageId}/attachments?$select=${ATTACHMENT_FIELDS}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const page = (await response.json()) as { value?: GraphAttachment[] };
  return page.value ?? [];
}
