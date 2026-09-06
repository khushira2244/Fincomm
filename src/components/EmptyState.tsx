import { colors, fontSans, fontSerif, radius } from "../theme";

export function EmptyState({
  heading,
  subtext,
  buttonLabel,
  onAction,
}: {
  heading: string;
  subtext: string;
  buttonLabel: string;
  onAction: () => void;
}) {
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
      <button
        onClick={onAction}
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
