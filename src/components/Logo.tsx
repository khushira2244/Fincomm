import { colors, fontSerif } from "../theme";

// Shared brand mark — icon + "FinComp" wordmark, with the tagline
// always shown directly beneath it. Used everywhere the logo appears
// (landing page nav, in-app Header, Sidebar) so the pairing never
// drifts out of sync between places.
const TAGLINE = "Know before you decide.";

function HouseIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9v-5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V20h2.5a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function Logo({
  dark = false,
  wordmarkSize = 20,
  taglineSize = 11,
  inline = false,
}: {
  // dark: for use on a light (cream) background — dark green text.
  // Default (false): for use on the deepGreen sidebar background — cream/sage text.
  dark?: boolean;
  wordmarkSize?: number;
  taglineSize?: number;
  // inline: icon + wordmark + tagline all on one row (for a compact
  // horizontal bar, e.g. the persistent top Header). Default: tagline
  // stacked directly beneath the wordmark (landing page, sign-in form).
  inline?: boolean;
}) {
  const wordmarkColor = dark ? colors.deepGreen : colors.cream;
  const taglineColor = dark ? colors.inkSoft : colors.sageGreen;

  if (inline) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <HouseIcon size={wordmarkSize + 2} color={wordmarkColor} />
          <span style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: `${wordmarkSize}px`, color: wordmarkColor }}>FinComp</span>
        </div>
        <span style={{ fontFamily: fontSerif, fontStyle: "italic", fontSize: `${taglineSize}px`, color: taglineColor }}>{TAGLINE}</span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <HouseIcon size={wordmarkSize + 2} color={wordmarkColor} />
        <span style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: `${wordmarkSize}px`, color: wordmarkColor }}>FinComp</span>
      </div>
      <div style={{ fontFamily: fontSerif, fontStyle: "italic", fontSize: `${taglineSize}px`, color: taglineColor, marginTop: "2px", marginLeft: `${wordmarkSize + 10}px` }}>
        {TAGLINE}
      </div>
    </div>
  );
}
