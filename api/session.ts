import { onRequestPost } from "../functions/api/session";
import { vercel } from "../functions/_lib/vercel";

export const POST = vercel(onRequestPost);
