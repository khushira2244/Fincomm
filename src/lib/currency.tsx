import { createContext, useContext, useMemo, ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CURRENCY_BY_COUNTRY, resolveCountry, type CurrencyInfo } from "../../convex/jurisdiction";

// Single source of truth for currency: the household's own `country`,
// set once at signup (see EmptyState.tsx) and never asked again. This
// provider reads it ONCE at the app root and every screen below reads
// it from context via useCurrency() — no screen re-derives or re-asks
// for a country/currency of its own.

type CurrencyContextValue = {
  currency: CurrencyInfo;
  // Formats a plain integer "minor unit" amount (the smallest whole
  // unit already used throughout this app's data — rupees/dollars/
  // euros as a whole number, not paise/cents) with the household's
  // real currency symbol and locale-appropriate digit grouping.
  format: (minorUnits: number | null | undefined) => string;
};

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const mine = useQuery(api.households.getMine);
  const country = resolveCountry(mine?.household.country);
  const currency = CURRENCY_BY_COUNTRY[country];

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      format: (minorUnits) =>
        minorUnits === null || minorUnits === undefined
          ? "—"
          : `${currency.symbol}${Math.round(minorUnits).toLocaleString(currency.locale)}`,
    }),
    [currency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

// Defaults to India/₹ outside the provider (e.g. the landing page,
// before a household exists) rather than throwing — consistent with
// resolveCountry's own default-to-IN behavior everywhere else.
const FALLBACK: CurrencyContextValue = {
  currency: CURRENCY_BY_COUNTRY.IN,
  format: (m) => (m === null || m === undefined ? "—" : `₹${Math.round(m).toLocaleString("en-IN")}`),
};

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext) ?? FALLBACK;
}
