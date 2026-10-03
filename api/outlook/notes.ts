import { onRequestGet, onRequestPatch, onRequestPost } from "../../functions/api/outlook/notes.js";
import { vercel } from "../../functions/_lib/vercel.js";

export const GET = vercel(onRequestGet);
export const POST = vercel(onRequestPost);
export const PATCH = vercel(onRequestPatch);
