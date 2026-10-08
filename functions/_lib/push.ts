import { createHash } from "node:crypto";
import webpush from "web-push";
import { redis } from "./redis.js";
import type { Env } from "./notion.js";

// Web Push to every colleague who turned notifications on, whatever meeting
// it is about (brief §9). A notification carries a title, a count and, for a
// note added, the names of its contacts — never a summary or a transcript.

const SUBS = "push:subs";

export type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } };
type Stored = { email: string; subscription: Subscription };

export type Notice = { title: string; body: string; url: string; tag?: string };

const fieldOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

export const pushEnabled = (env: Env) => Boolean(env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_SUBJECT);

export function isSubscription(value: unknown): value is Subscription {
  const sub = value as Subscription | null;
  return Boolean(
    sub &&
      typeof sub.endpoint === "string" &&
      sub.endpoint.startsWith("https://") &&
      typeof sub.keys?.p256dh === "string" &&
      typeof sub.keys?.auth === "string",
  );
}

/** One user may have several devices; each endpoint is one entry. */
export async function subscribe(env: Env, email: string, subscription: Subscription) {
  const value: Stored = { email, subscription: { endpoint: subscription.endpoint, keys: subscription.keys } };
  await redis(env).hset(SUBS, { [fieldOf(subscription.endpoint)]: value });
}

export async function unsubscribe(env: Env, endpoint: string) {
  await redis(env).hdel(SUBS, fieldOf(endpoint));
}

/**
 * Sends to everyone, and never throws: a notification that fails must not
 * turn a processed meeting into an error. A subscription the push service
 * calls gone (404, 410) is removed on the spot.
 */
export async function notifyAll(env: Env, notice: Notice): Promise<void> {
  if (!pushEnabled(env)) return;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
    const all = (await redis(env).hgetall<Record<string, Stored>>(SUBS)) ?? {};
    const payload = JSON.stringify(notice);
    await Promise.all(
      Object.entries(all).map(async ([field, stored]) => {
        try {
          await webpush.sendNotification(stored.subscription, payload, { TTL: 24 * 3600, urgency: "normal" });
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await redis(env).hdel(SUBS, field);
          else console.error(`[push] envoi refusé : ${status ?? "réseau"}`);
        }
      }),
    );
  } catch (error) {
    console.error(`[push] notifications indisponibles : ${(error as Error).name}`);
  }
}
