import { onRequestGet, onRequestPatch, onRequestPost } from "../../functions/api/outlook/notes";
import { vercel } from "../../functions/_lib/vercel";

export const GET = vercel(onRequestGet);
export const POST = vercel(onRequestPost);
export const PATCH = vercel(onRequestPatch);
