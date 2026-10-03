import { onRequestPost } from "../functions/api/files";
import { vercel } from "../functions/_lib/vercel";

export const POST = vercel(onRequestPost);
