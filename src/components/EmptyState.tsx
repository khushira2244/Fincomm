import { useState } from "react";
import { colors, fontSans, fontSerif, radius } from "../theme";
import { COUNTRY_LABELS, Country, DEFAULT_COUNTRY } from "../../convex/jurisdiction";

const COUNTRY_OPTIONS: Country[] = ["IN", "US", "EU", "OTHER"];

// Collected once, here, at account setup — never asked again unless the
// household changes it later in settings. Every service reads this off
// households.country (see convex/jurisdiction.ts); it decides which
// benchmark-rate source, tax logic, and regulator context is real for
// this household versus an honest "not available yet" fallback.
export function EmptyState({
  heading,
  subtext,
  buttonLabel,
  onAction,
}: {
  heading: string;
  subtext: string;
  buttonLabel: string;
  onAction: (country: Country) => void;
}) {
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "16px",
        padding: "96px 24px",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: colors.creamDim,
          border: `1px solid ${colors.sageGreen}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: colors.deepGreen,
          fontSize: "26px",
        }}
      >
        +
      </div>
      <h2 style={{ fontFamily: fontSerif, fontSize: "24px", margin: 0, color: colors.ink }}>
        {heading}
      </h2>
      <p style={{ fontFamily: fontSans, fontSize: "14px", color: colors.inkSoft, margin: 0 }}>
        {subtext}
      </p>
      <label style={{ display: "flex", flexDirection: "column", gap: "4px", width: "220px", fontFamily: fontSans, fontSize: "12px", color: colors.inkSoft }}>
        Country
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as Country)}
          style={{
            fontFamily: fontSans,
            fontSize: "14px",
            background: "#ffffff",
            color: colors.ink,
            border: `1px solid ${colors.sageGreen}`,
            borderRadius: radius,
            padding: "8px 10px",
          }}
        >
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {COUNTRY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => onAction(country)}
        style={{
          fontFamily: fontSans,
          fontWeight: 600,
          fontSize: "14px",
          background: colors.deepGreen,
          color: colors.cream,
          border: "none",
          borderRadius: radius,
          padding: "10px 20px",
          cursor: "pointer",
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
