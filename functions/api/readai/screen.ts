import type { NewContact } from "../../_lib/contact.js";
import { ContactError } from "../../_lib/contact.js";
import { fail, guard, json, NotionError, type Env, type Handler } from "../../_lib/notion.js";
import { isSubscription, subscribe, unsubscribe } from "../../_lib/push.js";
import { ConfigError } from "../../_lib/readai/note.js";
import { retry } from "../../_lib/readai/process.js";
import {
  countItems,
  decide,
  excludedList,
  ignore,
  listItems,
  loadItem,
  QueueError,
  removeExcluded,
  viewOf,
  type DecideInput,
} from "../../_lib/readai/queue.js";
import { StorageUnavailable } from "../../_lib/redis.js";

// The routes of the « À valider » screen: /api/readai/items, decide, ignore,
// retry, excluded, push. One function for all of them (research E-1), every
// one behind guard() — they show client meetings and create contacts.
// contracts/readai-screen.md.

const actionOf = (request: Request) => new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "";

const body = async <T>(request: Request) => (await request.json().catch(() => ({}))) as T;

/** Errors as the screen reads them; a failed note hands back its item. */
async function failure(env: Env, error: unknown, itemId?: string) {
  if (error instanceof QueueError) return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof ContactError) return json({ error: error.message }, 400);
  if (error instanceof StorageUnavailable) return json({ error: "Stockage indisponible", retry: true }, 503);
  const item = itemId ? await loadItem(env, itemId).catch(() => null) : null;
  if (error instanceof ConfigError) {
    return json({ error: error.message, retry: false, ...(item ? { item: viewOf(item) } : {}) }, 500);
  }
  if (error instanceof NotionError) {
    const response = fail(error);
    const data = (await response.json()) as Record<string, unknown>;
    return json({ ...data, ...(item ? { item: viewOf(item) } : {}) }, response.status);
  }
  console.error(`[readai] écran : ${(error as Error)?.name ?? "Error"}`);
  return json({ error: "Erreur inattendue", retry: true, ...(item ? { item: viewOf(item) } : {}) }, 500);
}

export const onRequestGet: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  if (actionOf(request) !== "items") return json({ error: "Route inconnue" }, 404);
  try {
    if (new URL(request.url).searchParams.has("count")) return json({ count: await countItems(env) });
    const [items, excluded] = await Promise.all([listItems(env), excludedList(env)]);
    return json({ items, excluded, count: items.length });
  } catch (error) {
    return failure(env, error);
  }
};

export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const { user } = denied;

  switch (actionOf(request)) {
    case "decide": {
      const input = await body<{
        itemId?: string;
        email?: string;
        action?: string;
        contactId?: string;
        contact?: NewContact;
      }>(request);
      if (!input.itemId || !input.email) return json({ error: "Requête incomplète" }, 400);
      let decision: DecideInput;
      if (input.action === "attach") decision = { action: "attach", contactId: input.contactId ?? "" };
      else if (input.action === "create") decision = { action: "create", contact: input.contact ?? {} };
      else if (input.action === "exclude") decision = { action: "exclude" };
      else return json({ error: "Action inconnue" }, 400);
      try {
        return json(await decide(env, user, input.itemId, input.email, decision));
      } catch (error) {
        return failure(env, error, input.itemId);
      }
    }
    case "ignore": {
      const { itemId } = await body<{ itemId?: string }>(request);
      if (!itemId) return json({ error: "Requête incomplète" }, 400);
      try {
        return json(await ignore(env, itemId));
      } catch (error) {
        return failure(env, error);
      }
    }
    case "retry": {
      const { itemId } = await body<{ itemId?: string }>(request);
      if (!itemId) return json({ error: "Requête incomplète" }, 400);
      try {
        return json(await retry(env, itemId));
      } catch (error) {
        return failure(env, error, itemId);
      }
    }
    case "excluded": {
      const { email, action } = await body<{ email?: string; action?: string }>(request);
      if (!email || action !== "remove") return json({ error: "Requête incomplète" }, 400);
      try {
        await removeExcluded(env, email);
        return json({ excluded: await excludedList(env) });
      } catch (error) {
        return failure(env, error);
      }
    }
    case "push": {
      const { subscription } = await body<{ subscription?: unknown }>(request);
      if (!isSubscription(subscription)) return json({ error: "Abonnement invalide" }, 400);
      try {
        await subscribe(env, user.email, subscription);
        return json({ ok: true }, 201);
      } catch (error) {
        return failure(env, error);
      }
    }
    default:
      return json({ error: "Route inconnue" }, 404);
  }
};

export const onRequestDelete: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  if (actionOf(request) !== "push") return json({ error: "Route inconnue" }, 404);
  const { endpoint } = await body<{ endpoint?: string }>(request);
  if (!endpoint) return json({ error: "Requête incomplète" }, 400);
  try {
    await unsubscribe(env, endpoint);
    return json({ ok: true });
  } catch (error) {
    return failure(env, error);
  }
};
