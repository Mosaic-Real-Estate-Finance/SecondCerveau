import { onRequestPost } from "../../functions/api/auth.js";
import { vercel } from "../../functions/_lib/vercel.js";

// One function for /api/auth/code, /verify and /logout (research E-1).
export const POST = vercel(onRequestPost);
