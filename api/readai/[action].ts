import { onRequestDelete, onRequestGet, onRequestPost } from "../../functions/api/readai/screen.js";
import { vercel } from "../../functions/_lib/vercel.js";

// One function for every route of the « À valider » screen (research E-1).
// /api/readai/webhook is its own file, and a static file wins over this one.
export const GET = vercel(onRequestGet);
export const POST = vercel(onRequestPost);
export const DELETE = vercel(onRequestDelete);
