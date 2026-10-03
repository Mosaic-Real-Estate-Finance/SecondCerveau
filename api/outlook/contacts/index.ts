import { onRequestPost } from "../../../functions/api/outlook/contacts/index.js";
import { vercel } from "../../../functions/_lib/vercel.js";

export const POST = vercel(onRequestPost);
