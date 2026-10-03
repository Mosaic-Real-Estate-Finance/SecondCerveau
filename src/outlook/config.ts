// What the panel needs to know before any call: which addresses are Mosaic's
// own, and therefore never candidates for the contact relation.
//
// The server holds the authority on both — INTERNAL_DOMAINS as an environment
// variable, and the allowlist in functions/_lib/users.ts. These copies only
// decide what the panel shows before the first request; a wrong guess here
// cannot authorise anything, because every route checks for itself.

export const INTERNAL_DOMAINS = ["mosaicfin.com"];

export const USERS_EMAILS = ["ob@mosaicfin.com", "pb@mosaicfin.com", "xn@mosaicfin.com", "theo@gouman.fr"];
