// Terms the transcription is told to expect, sent with every stream as
// Soniox context (`context.terms`). Proper nouns and jargon are where a
// general model goes wrong, and a few hundred of them cost nothing: the
// context allows about 8,000 tokens.
//
// Two parts. Here, the trade's own words — sigles, English and French jargon
// of real-estate financing — which do not change. The names — contacts,
// companies, the team, the projects in the subjects of the notes — come from
// Notion with the stream key (functions/_lib/vocabulary.ts): they follow the
// base as it grows, and they are never written into the code.

const BANKS = ["SOCFIM", "BPCE", "Arkea"];

const SIGLES = [
  "LTV",
  "LTC",
  "TRI",
  "IRR",
  "VEFA",
  "MDB",
  "GAPD",
  "GFA",
  "SCI",
  "SAS",
  "SPV",
  "JV",
  "LBO",
  "LOI",
  "CCA",
  "BFR",
  "SCPI",
  "AIFM",
  "AMF",
  "AUM",
  "LMNP",
  "HNWI",
  "UHNWI",
  "CGP",
  "AMO",
  "EBITDA",
  "CAPEX",
  "OPEX",
  "KYC",
  "ISIN",
  "ERP",
  "RDC",
  "IDF",
  "DPE",
  "PLU",
  "Kbis",
  "Euribor",
  "bps",
];

const JARGON_EN = [
  "whole loan",
  "senior",
  "junior",
  "mezzanine",
  "mezz",
  "bridge",
  "refi",
  "equity",
  "private equity",
  "private debt",
  "club deal",
  "term sheet",
  "cap rate",
  "value add",
  "core plus",
  "closing",
  "due diligence",
  "data room",
  "sponsor",
  "origination",
  "covenant",
  "waiver",
  "drawdown",
  "tranche",
  "exit",
  "pricing",
  "upfront fees",
  "cash-flow",
  "asset management",
  "family office",
  "flex living",
  "dealflow",
  "pipeline",
  "coverage",
  "ticket",
  "business plan",
];

const JARGON_FR = [
  "réitération",
  "promesse de vente",
  "fiducie",
  "hypothèque",
  "nantissement",
  "caution",
  "garantie à première demande",
  "indemnité d'éviction",
  "permis de construire",
  "purge des recours",
  "pré-commercialisation",
  "appel de fonds",
  "crédit promoteur",
  "garantie financière d'achèvement",
  "in fine",
  "dation",
  "marchand de biens",
  "foncière",
  "obligataire",
  "compte courant d'associé",
  "fonds propres",
  "quasi-fonds propres",
  "portage foncier",
  "vente en bloc",
  "loi de 1948",
  "décaissement",
  "collatéral",
  "encours",
  "exclusivité",
];

export const VOCABULARY: string[] = ["Mosaic", ...BANKS, ...SIGLES, ...JARGON_EN, ...JARGON_FR];

/** The fixed jargon, then the names from Notion, once each. */
export function vocabularyFor(names: string[] = []): string[] {
  const seen = new Set<string>();
  return [...VOCABULARY, ...names].filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
