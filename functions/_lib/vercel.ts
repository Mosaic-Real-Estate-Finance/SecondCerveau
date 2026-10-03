import type { Env, Handler } from "./notion";

// The one difference between a Pages Function and a Vercel Function, as far as
// this codebase is concerned.
//
// Both receive a web-standard `Request` and return a web-standard `Response`.
// Cloudflare hands the environment in as an argument; Vercel puts it in
// `process.env`. So the handlers are not rewritten — they are wrapped, once,
// here. Every route keeps the exact code that was tested against Notion.
export const vercel =
  (handler: Handler) =>
  (request: Request): Promise<Response> =>
    handler({ request, env: process.env as unknown as Env });
