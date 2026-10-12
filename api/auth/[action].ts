import { onRequestGet, onRequestPost } from "../../functions/api/auth.js";
import { vercel } from "../../functions/_lib/vercel.js";

// One function for every /api/auth route (research E-1): code, verify, logout,
// stt-token, handoff, redeem, and GET manifest.
export const POST = vercel(onRequestPost);
export const GET = vercel(onRequestGet);
