import { onRequestGet, onRequestPost } from "../../functions/api/outlook/attachments.js";
import { vercel } from "../../functions/_lib/vercel.js";

export const GET = vercel(onRequestGet);
export const POST = vercel(onRequestPost);
