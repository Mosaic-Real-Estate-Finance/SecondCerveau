import { onRequestPost } from "../functions/api/notes.js";
import { vercel } from "../functions/_lib/vercel.js";

export const POST = vercel(onRequestPost);
