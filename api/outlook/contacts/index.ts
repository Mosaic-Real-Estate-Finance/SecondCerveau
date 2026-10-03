import { onRequestPost } from "../../../functions/api/outlook/contacts/index";
import { vercel } from "../../../functions/_lib/vercel";

export const POST = vercel(onRequestPost);
