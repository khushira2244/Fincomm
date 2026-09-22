// Jurisdiction configuration — the single place every service reads
// country-specific source/authority info from, instead of hardcoding
// RBI/IRDAI/Income-Tax-Department directly. Adding a real, working
// jurisdiction means adding a real entry here (with a genuinely scraped,
// verified source) — never adding a country label with no real source
// behind it. `rateSourceUrl: null` means "no live benchmark-rate source
// configured yet for this country" — callers must treat that as
// "unavailable", never silently fall back to another country's number.

export type Country = "IN" | "US" | "EU" | "OTHER";

export const DEFAULT_COUNTRY: Country = "IN";

export const COUNTRY_LABELS: Record<Country, string> = {
  IN: "India",
  US: "United States",
  EU: "European Union",
  OTHER: "Other / not listed",
};

export type JurisdictionConfig = {
  label: string;
  // Benchmark interest rate (Loan & Debt Resilience's reference-rate
  // context). null = no live source configured yet for this country.
  rateSourceLabel: string | null;
  rateSourceUrl: string | null;
  rateAuthorityLevel: string;
  // Tax Planning / Insurance / Investment reuse this to decide whether
  // to compute real jurisdiction-specific numbers or show the honest
  // "not available yet" fallback — these are structurally different
  // per country (different brackets, deduction categories, regulatory
  // bodies), not swappable data, so only IN has real logic today.
  taxAuthorityLabel: string | null;
  insuranceRegulatorLabel: string | null;
};

export const jurisdictionConfig: Record<Country, JurisdictionConfig> = {
  IN: {
    label: "India",
    rateSourceLabel: "Reserve Bank of India — official Policy Repo Rate",
    rateSourceUrl: "https://www.rbi.org.in/",
    rateAuthorityLevel: "official-central-bank",
    taxAuthorityLabel: "Income Tax Department (incometax.gov.in)",
    insuranceRegulatorLabel: "IRDAI",
  },
  US: {
    label: "United States",
    rateSourceLabel: "Federal Reserve — official Federal Funds Rate (H.15 release)",
    rateSourceUrl: "https://www.federalreserve.gov/releases/h15/",
    rateAuthorityLevel: "official-central-bank",
    taxAuthorityLabel: null, // Tax Planning has no US logic yet — honest fallback, see taxPlanning.ts
    insuranceRegulatorLabel: null,
  },
  EU: {
    label: "European Union",
    rateSourceLabel: null, // not built yet — no fabricated source
    rateSourceUrl: null,
    rateAuthorityLevel: "unavailable",
    taxAuthorityLabel: null,
    insuranceRegulatorLabel: null,
  },
  OTHER: {
    label: "Other / not listed",
    rateSourceLabel: null,
    rateSourceUrl: null,
    rateAuthorityLevel: "unavailable",
    taxAuthorityLabel: null,
    insuranceRegulatorLabel: null,
  },
};

export function resolveCountry(raw: string | null | undefined): Country {
  if (raw === "IN" || raw === "US" || raw === "EU" || raw === "OTHER") return raw;
  return DEFAULT_COUNTRY;
}

// Tax Planning / Insurance / Investment are India-specific (their real,
// verified sources are incometax.gov.in, IRDAI, and SEBI respectively)
// and are not being rebuilt per-country. Returns a caveat string to
// append to a result's existing `caveats` array when the household's
// country isn't India — null when it is (nothing to add). Additive
// only: callers push this into an array that already exists, never
// changes what was computed.
export function nonIndiaJurisdictionCaveat(country: Country, sourceName: string): string | null {
  if (country === "IN") return null;
  return `This guidance is based on India's ${sourceName} rules and may not apply to your selected region (${COUNTRY_LABELS[country]}). Country-specific support for this service isn't available yet.`;
}
