import { guard, json, type Handler } from "../_lib/notion.js";
import { issueSession } from "../_lib/session.js";

// The session the PWA carries, read back at every launch. A valid one is
// re-issued for another 90 days: the session slides as long as the app is
// opened at least once in that time (research G-1). No Notion call.
const current: Handler = async ({ request, env }) => {
  const denied = await guard(request, env);
  if (denied instanceof Response) return denied;
  const response = json({ email: denied.user.email, firstName: denied.user.firstName });
  // Only a cookie session slides; the add-in's Microsoft token is not ours.
  if (!request.headers.get("authorization")) {
    response.headers.append("Set-Cookie", await issueSession(env, denied.user.email));
  }
  return response;
};

export const onRequestGet = current;
export const onRequestPost = current;
