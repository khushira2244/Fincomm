import { CSSProperties } from "react";
import { colors } from "../theme";

// Circular avatar: the user's first initial (deep green / cream) when
// signed in, or a plain outline person icon in a muted circle when not.
export function Avatar({
  initial,
  size = 32,
}: {
  initial?: string | null;
  size?: number;
}) {
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: "inherit",
  };

  if (initial) {
    return (
      <div
        style={{
          ...base,
          background: colors.deepGreen,
          color: colors.cream,
          fontWeight: 600,
          fontSize: size * 0.45,
        }}
      >
        {initial.toUpperCase()}
      </div>
    );
  }

  return (
    <div
      style={{
        ...base,
        background: colors.creamDim,
        color: colors.inkSoft,
        border: `1px solid ${colors.sageGreen}`,
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    </div>
  );
}
