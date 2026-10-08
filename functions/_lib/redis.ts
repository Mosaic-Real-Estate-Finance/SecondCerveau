import { Redis } from "@upstash/redis";
import type { Env } from "./notion.js";

// The operational store of feature 002 — and only that. Constitution 2.0.0,
// principle II, lists what may live here: the queue of calls waiting for a
// decision, the exclusion list, push subscriptions, sign-in codes and revoked
// sessions, deduplication marks and locks. Anything validated lives in Notion.
//
// Upstash over REST, because a function has no connection to keep warm. The
// Vercel Marketplace integration injects KV_REST_API_*, or <prefix>_KV_REST_API_*
// when a custom prefix was chosen at install; projects created later get
// UPSTASH_REDIS_REST_*. All are read.

export class StorageUnavailable extends Error {
  constructor() {
    super("Stockage indisponible");
  }
}

let client: Redis | null = null;

// The read-only token ends in _KV_REST_API_READ_ONLY_TOKEN, so the suffix
// never picks it up.
const prefixed = (env: Env, suffix: string) => {
  const values = env as unknown as Record<string, string | undefined>;
  const key = Object.keys(values).find((name) => name.endsWith(suffix) && values[name]);
  return key ? values[key] : undefined;
};

export function redis(env: Env): Redis {
  if (client) return client;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || prefixed(env, "_KV_REST_API_URL");
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || prefixed(env, "_KV_REST_API_TOKEN");
  if (!url || !token) throw new StorageUnavailable();
  client = new Redis({ url, token });
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const token = () => crypto.randomUUID();

/**
 * Takes the lock, waiting for it up to `waitMs`. Resolves to the holder's
 * token, or null when someone else kept it the whole time.
 *
 * The TTL is the safety net for a function that dies holding it: nobody has
 * to clean up after a crash, the key simply runs out.
 */
export async function acquire(env: Env, key: string, ttlSeconds: number, waitMs = 0): Promise<string | null> {
  const mine = token();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const taken = await redis(env).set(key, mine, { nx: true, ex: ttlSeconds });
    if (taken === "OK") return mine;
    if (Date.now() >= deadline) return null;
    await sleep(500);
  }
}

// Deleted only if it is still ours: a holder that overran its TTL must not
// release the lock of whoever took it next.
const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export async function release(env: Env, key: string, held: string): Promise<void> {
  await redis(env)
    .eval(RELEASE, [key], [held])
    .catch(() => undefined);
}
