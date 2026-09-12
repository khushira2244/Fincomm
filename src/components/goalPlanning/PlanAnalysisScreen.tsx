import { FormEvent, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { inputStyle, linkStyle, primaryButtonStyle } from "./kit";

type CategoryCard = {
  key: string;
  title: string;
  dot: "green" | "amber";
  summary: string;
  detail: string;
  timelineRefs: { timelineId: string; label: string }[];
};

type AnalysisResult = {
  verdict: string;
  categories: CategoryCard[];
  whatIfChips: string[];
};

type WhatIfAnswer = {
  verdict: string;
  stats: { label: string; value: string }[];
  explanation: string;
  calculationDetail: string;
};

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

const caps: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: colors.inkSoft,
  margin: "0 0 8px",
};

export function PlanAnalysisScreen({
  onBack,
  onOpenTimeline,
}: {
  onBack: () => void;
  onOpenTimeline: (timelineId: Id<"timelines">) => void;
}) {
  const analysis = useQuery(api.planAnalysis.getLatestAnalysis);
  const regenerate = useAction(api.planAnalysis.generateAnalysis);
  const [regenBusy, setRegenBusy] = useState(false);

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <span onClick={onBack} style={{ ...linkStyle, marginTop: 0 }}>
          ← Back to timelines
        </span>
        <div>
          <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>
            Your plan, at a glance
          </h1>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>
            Based on everything you&apos;ve added to Financial Foundation and your timelines.
          </div>
        </div>

        {analysis === undefined && <p style={{ color: colors.inkSoft }}>loading…</p>}

        {analysis === null && (
          <div
            style={{
              border: `1px solid ${colors.sageGreen}`,
              borderRadius: radius,
              background: "#ffffff",
              padding: "20px 24px",
              fontSize: "14px",
              color: colors.inkSoft,
            }}
          >
            No analysis yet. Confirm a timeline (from its detail page) to generate one.
          </div>
        )}

        {analysis && (
          <>
            {!analysis.isCurrent && (
              <div
                style={{
                  border: "1px dashed #C9A44C",
                  background: "#F7ECD4",
                  borderRadius: radius,
                  padding: "10px 14px",
                  fontSize: "13px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <span>Your data has changed since this analysis was generated.</span>
                <button
                  style={primaryButtonStyle}
                  disabled={regenBusy}
                  onClick={() => {
                    setRegenBusy(true);
                    void regenerate({}).finally(() => setRegenBusy(false));
                  }}
                >
                  {regenBusy ? "Re-analysing…" : "Re-analyse"}
                </button>
              </div>
            )}

            <div
              style={{
                background: colors.deepGreen,
                color: colors.cream,
                borderRadius: radius,
                padding: "18px 20px",
              }}
            >
              <div style={{ ...caps, color: colors.sageGreen, margin: "0 0 6px" }}>Overall</div>
              <div style={{ fontSize: "16px", lineHeight: 1.4 }}>
                {(analysis.result as AnalysisResult).verdict}
              </div>
            </div>

            <div>
              <div style={caps}>By category</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(analysis.result as AnalysisResult).categories.map((c) => (
                  <CategoryAccordion key={c.key} card={c} onOpenTimeline={onOpenTimeline} />
                ))}
              </div>
            </div>

            <WhatIfSection chips={(analysis.result as AnalysisResult).whatIfChips} />

            <div style={{ fontSize: "12px", color: colors.inkSoft }}>
              Last analysed {timeAgo(analysis.createdAt)} ago
              {analysis.isCurrent ? " — still current, nothing has changed since." : "."}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function CategoryAccordion({
  card,
  onOpenTimeline,
}: {
  card: CategoryCard;
  onOpenTimeline: (timelineId: Id<"timelines">) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        background: "#ffffff",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            flexShrink: 0,
            background: card.dot === "green" ? colors.midGreen : "#C9902C",
          }}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "14px" }}>{card.title}</div>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>{card.summary}</div>
        </div>
        <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px 34px", fontSize: "13px" }}>
          <p style={{ margin: "0 0 8px" }}>{card.detail}</p>
          {card.timelineRefs.map((ref) => (
            <span
              key={ref.timelineId}
              onClick={() => onOpenTimeline(ref.timelineId as Id<"timelines">)}
              style={{ ...linkStyle, marginRight: "12px" }}
            >
              Open {ref.label} →
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WhatIfSection({ chips }: { chips: string[] }) {
  const ask = useAction(api.planAnalysis.answerWhatIf);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<WhatIfAnswer | null>(null);
  const [showCalc, setShowCalc] = useState(false);

  const run = (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    setShowCalc(false);
    void ask({ question: q.trim() })
      .then((a) => setAnswer(a))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div style={caps}>Ask a &ldquo;what if&rdquo;</div>
      <div
        style={{
          border: `1px solid ${colors.sageGreen}`,
          borderRadius: radius,
          background: "#ffffff",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={{ fontFamily: fontSerif, fontSize: "16px", fontWeight: 700 }}>What if…?</div>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>
          Ask about a risk to your finances. We&apos;ll calculate the real numbers and explain what it
          would mean.
        </div>
        <form
          style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            run(question);
          }}
        >
          <input
            style={{ ...inputStyle, flex: 1, minWidth: "240px" }}
            placeholder="e.g. What if I lost my job for 6 months?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button style={primaryButtonStyle} type="submit" disabled={busy}>
            Ask
          </button>
        </form>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => {
                setQuestion(c);
                run(c);
              }}
              style={{
                fontFamily: fontSans,
                fontSize: "12px",
                background: "#F7ECD4",
                color: colors.ink,
                border: "1px solid #C9A44C",
                borderRadius: "14px",
                padding: "4px 12px",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
        </div>

        {busy && <div style={{ fontSize: "13px", color: colors.inkSoft }}>Calculating…</div>}

        {answer && (
          <div
            style={{
              border: `1px solid ${colors.sageGreen}`,
              borderRadius: radius,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: "14px" }}>{answer.verdict}</div>
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
              {answer.stats.map((s) => (
                <div key={s.label}>
                  <div style={{ fontSize: "16px", fontWeight: 700 }}>{s.value}</div>
                  <div style={{ fontSize: "12px", color: colors.inkSoft }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "13px" }}>{answer.explanation}</div>
            <span onClick={() => setShowCalc(!showCalc)} style={{ ...linkStyle, marginTop: 0 }}>
              {showCalc ? "Hide the calculation" : "See the full calculation"}
            </span>
            {showCalc && (
              <div style={{ fontSize: "12px", color: colors.inkSoft, whiteSpace: "pre-wrap" }}>
                {answer.calculationDetail}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
