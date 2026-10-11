// Terms the transcription is told to expect, sent with every stream as
// Soniox context (`context.terms`). Proper nouns and jargon are where a
// general model goes wrong, and a few hundred of them cost nothing: the
// context allows about 8,000 tokens.
//
// A plain list for now. It could later be fed from Notion — company names
// from the Contacts base, for instance — and fetched with the stream key.

export const VOCABULARY: string[] = [
  "SOCFIM",
  "BPCE",
  "Arkea",
  "mezzanine",
  "whole loan",
  "LTV",
  "LTC",
  "TRI",
  "VEFA",
  "MDB",
  "réitération",
  "promesse de vente",
  "indemnité d'éviction",
  "fiducie",
  "GAPD",
  "cap rate",
  "in fine",
  "club deal",
  "data room",
  "exclusivité",
];
