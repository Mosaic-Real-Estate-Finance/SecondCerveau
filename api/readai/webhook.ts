import { onRequestPost } from "../../functions/api/readai/webhook.js";
import { vercel } from "../../functions/_lib/vercel.js";

export const POST = vercel(onRequestPost);
