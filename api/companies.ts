import { onRequestGet, onRequestPost } from "../functions/api/companies";
import { vercel } from "../functions/_lib/vercel";

export const GET = vercel(onRequestGet);
export const POST = vercel(onRequestPost);
