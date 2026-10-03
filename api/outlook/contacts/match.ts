import { onRequestPost } from "../../../functions/api/outlook/contacts/match";
import { vercel } from "../../../functions/_lib/vercel";

export const POST = vercel(onRequestPost);
