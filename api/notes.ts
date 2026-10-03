import { onRequestPost } from "../functions/api/notes";
import { vercel } from "../functions/_lib/vercel";

export const POST = vercel(onRequestPost);
