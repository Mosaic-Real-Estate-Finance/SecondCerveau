import { guard, json, type Handler } from "../_lib/notion.js";

// Checks the address against the allowlist and hands back the first name the
// home screen greets. No Notion call, so the access screen answers at once.
export const onRequestPost: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  return json({ email: denied.user.email, firstName: denied.user.firstName });
};
