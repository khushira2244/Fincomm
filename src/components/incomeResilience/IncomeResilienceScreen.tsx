import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, ghostButtonStyle, inputStyle, primaryButtonStyle } from "../goalPlanning/kit";
import type { ServiceKey } from "../Sidebar";

// =====================================================================
// Income Resilience — cross-service SYNTHESIS, not a new domain.
// Structurally different from the input-first screens elsewhere in the
// app: there is no form driving a calculation here. The score itself
// is computed live from data that already lives in Financial
// Foundation, Loan & Debt, Insurance, Side-Income, and Government/
// Economic Intelligence — this screen just asks the backend to run
// that check and renders the result. The one thing a household CAN
// tell us directly — the note — never moves the score; it only colors
// the narration honestly.
// =====================================================================

const AMBER = "#8A6D1F";
const AMBER_BG = "#F5EBD8";
const SIGNIFICANT_RED = "#A13D3D";
const RED_BG = "#F3DEDE";
const GREEN_BG = "#E4EEE8";
const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };

const dayMonth = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Tier = "resilient" | "worthALook" | "atRisk";

const TIER_LABEL: Record<Tier, string> = { resilient: "Resilient", worthALook: "Worth a look", atRisk: "At risk" };
const TIER_COLOR: Record<Tier, string> = { resilient: colors.deepGreen, worthALook: AMBER, atRisk: SIGNIFICANT_RED };

// Each weak-dimension key maps to the service it routes into, and a
// deterministic (not AI-generated) label for the fix link — matches
// exactly what the backend can actually detect, never overclaiming.
const DIMENSION_FIX: Record<string, { label: string; navigate: ServiceKey }> = {
  incomeConcentration: { label: "Add another income source in Financial Foundation", navigate: "financialFoundation" },
  emiRatio: { label: "Review your loans in Loan & Debt Resilience", navigate: "loanDebt" },
  structuralDeficit: { label: "Review your loans in Loan & Debt Resilience", navigate: "loanDebt" },
  insurance: { label: "Add a policy in Insurance, Protection & Financial Rights", navigate: "insurance" },
  liquidReserve: { label: "Explore Investment & Risk Planning", navigate: "investment" },
  backupIncome: { label: "Explore Side-Income & Business Planning", navigate: "sideIncome" },
  externalRisk: { label: "See what changed in Government, Economic & Livelihood Intelligence", navigate: "governmentEconomic" },
};

export function IncomeResilienceScreen({ onNavigate }: { onNavigate: (key: ServiceKey) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useAction(api.incomeResilience.checkIncomeResilience);

  const runCheck = () => {
    setBusy(true);
    setError(null);
    void check({})
      .then((r) => setResult(r))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  // Auto-run once on load — there's nothing for the user to fill in
  // first, the score is meant to just be there.
  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "780px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px" }}>
        <div>
          <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>Income Resilience</h1>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>
            One honest read on how ready your household is for an income shock — pulled live from everything else already in FinComp. No form to fill in here; this updates itself as your other sections change.
          </div>
        </div>

        {error && (
          <Card>
            <p style={{ fontSize: "13px", color: "#a13d3d", margin: 0 }}>{error}</p>
          </Card>
        )}

        {busy && !result && <Card><div style={{ fontSize: "12px", color: colors.inkSoft }}>Checking…</div></Card>}

        {result && <HeroCard result={result} busy={busy} onRecheck={runCheck} />}

        <NoteCard onSaved={runCheck} />

        {result && <DimensionBreakdown result={result} onNavigate={onNavigate} />}

        <BenchmarkStrip />

        <TrendCard />

        {result && result.narration.caveats.length > 0 && (
          <div style={{ background: AMBER_BG, border: `1px dashed ${AMBER}`, borderRadius: radius, padding: "12px 14px", fontSize: "12.5px", color: colors.ink }}>
            <strong style={{ color: AMBER, display: "block", marginBottom: "4px" }}>What this is, and isn&rsquo;t</strong>
            This is a starting point to explore in the relevant FinComp section, not a financial plan.
            <ul style={{ margin: "4px 0 0", paddingLeft: "16px" }}>
              {(result.narration.caveats as string[]).map((c: string, i: number) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {result && <ActionRow result={result} />}

        <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
          Pulled live from Financial Foundation, Loan &amp; Debt Resilience, Insurance, Side-Income &amp; Business Planning, and Government, Economic &amp; Livelihood Intelligence.
        </p>
      </div>
    </main>
  );
}

// =====================================================================
// Hero tier card
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HeroCard({ result, busy, onRecheck }: { result: any; busy: boolean; onRecheck: () => void }) {
  const tier = result.tier as Tier;
  return (
    <div style={{ background: TIER_COLOR[tier], color: colors.cream, borderRadius: radius, padding: "22px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div>
          <span
            style={{
              display: "inline-block",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              background: "rgba(255,255,255,0.2)",
              borderRadius: "12px",
              padding: "4px 12px",
              marginBottom: "10px",
            }}
          >
            {TIER_LABEL[tier]}
          </span>
          <div style={{ fontFamily: fontSerif, fontSize: "19px", margin: "0 0 8px", lineHeight: 1.35 }}>{result.narration.headline}</div>
          <p style={{ fontSize: "13.5px", lineHeight: 1.5, margin: 0, opacity: 0.95, maxWidth: "560px" }}>{result.narration.plainLanguage}</p>
        </div>
        <button
          onClick={onRecheck}
          disabled={busy}
          style={{
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.4)",
            color: colors.cream,
            borderRadius: radius,
            padding: "7px 14px",
            fontSize: "12.5px",
            fontFamily: fontSans,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {busy ? "…" : "↻ Recheck now"}
        </button>
      </div>
      <div style={{ fontSize: "11px", opacity: 0.8, marginTop: "12px" }}>updates automatically when your data changes elsewhere</div>
    </div>
  );
}

// =====================================================================
// Note card
// =====================================================================

function NoteCard({ onSaved }: { onSaved: () => void }) {
  const existing = useQuery(api.incomeResilience.getMyNote, {});
  const save = useAction(api.incomeResilience.saveResilienceNote);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const draft = text ?? existing?.freeText ?? "";
  const category = existing?.interpretedConcernCategory;

  const submit = () => {
    setBusy(true);
    setSaved(false);
    void save({ freeText: draft })
      .then(() => {
        setSaved(true);
        onSaved();
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card>
      <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>Anything on your mind?</div>
      <div style={{ fontSize: "12.5px", color: colors.inkSoft, marginBottom: "10px" }}>
        We can only see what&rsquo;s already in FinComp — tell us in your own words if something&rsquo;s changed. This stays saved and factors into both this check and next week&rsquo;s automatic one.
      </div>
      <textarea
        style={{ ...f, minHeight: "70px", resize: "vertical", fontFamily: fontSans, background: colors.cream }}
        value={draft}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Worried about layoffs at my company, or my father's unwell and I may need to support him financially."
      />
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
        <button style={primaryButtonStyle} disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save note"}
        </button>
        {category && category !== "none" && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              background: AMBER_BG,
              color: AMBER,
              borderRadius: "10px",
              padding: "3px 10px",
            }}
          >
            {CONCERN_LABEL[category] ?? category}
          </span>
        )}
        {saved && <span style={{ fontSize: "12px", color: colors.deepGreen }}>Saved ✓</span>}
      </div>
      {existing && (
        <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "6px" }}>
          Noted {dayMonth(existing.updatedAt)} — factored into the narration above, not into the score itself
        </div>
      )}
    </Card>
  );
}

const CONCERN_LABEL: Record<string, string> = {
  jobSecurity: "Job security concern",
  healthOrDependent: "Health / dependent concern",
  majorLifeEvent: "Major life event",
  businessConcern: "Business concern",
};

// =====================================================================
// Dimension breakdown
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DimensionBreakdown({ result, onNavigate }: { result: any; onNavigate: (key: ServiceKey) => void }) {
  const weakKeys = new Set((result.weakDimensions as { key: string }[]).map((d) => d.key));
  const rows: { key: string; title: string; value: string }[] = [
    { key: "incomeConcentration", title: "Income concentration", value: `${Math.round(result.incomeConcentrationPercent)}% of dependable income comes from a single source.` },
    { key: "structuralDeficit", title: "Structural deficit", value: result.hasBreachedObligation ? "Essential expenses and EMIs currently exceed dependable income." : "Essential expenses and EMIs are currently covered by income." },
    { key: "runway", title: "Runway", value: result.runwayStatus === "depleting" ? `Depleting — ${result.runwayMonths.toFixed(1)} months at the current burn rate (recommended: ${result.recommendedRunwayMonths}).` : "Not currently depleting." },
    { key: "emiRatio", title: "EMI burden", value: `EMIs take up ${Math.round(result.emiToIncomeRatioPercent)}% of dependable income (flagged at 50%+).` },
    { key: "insurance", title: "Income-protection insurance", value: result.hasIncomeProtectionInsurance ? "An active life or personal-accident policy is recorded." : "No active life or personal-accident policy recorded." },
    { key: "liquidReserve", title: "Extra liquid reserve", value: `₹${Math.round(result.liquidInvestmentsMinorUnits).toLocaleString("en-IN")} in semi-liquid assets beyond your emergency runway.` },
    { key: "backupIncome", title: "Backup income", value: result.hasBackupIncomeInProgress ? "An active or graduated business/side income is in progress." : "No active or graduated backup income in progress." },
    { key: "externalRisk", title: "External risk signal", value: result.hasRecentSignificantEconomicFinding ? "A real, recent significant finding was flagged on your track." : "No recent significant external finding." },
  ];

  return (
    <>
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft }}>What&rsquo;s behind this score</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {rows.map((row) => {
          const weak = weakKeys.has(row.key);
          const fix = DIMENSION_FIX[row.key];
          return (
            <div
              key={row.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
                padding: "12px 14px",
                borderRadius: radius,
                border: `1px solid ${colors.creamDim}`,
                borderLeft: `3px solid ${weak ? SIGNIFICANT_RED : colors.midGreen}`,
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: "1px",
                  background: weak ? RED_BG : GREEN_BG,
                  color: weak ? SIGNIFICANT_RED : colors.midGreen,
                }}
              >
                {weak ? "!" : "✓"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 600 }}>{row.title}</div>
                <div style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "2px" }}>{row.value}</div>
                {weak && fix && (
                  <span
                    onClick={() => onNavigate(fix.navigate)}
                    style={{ fontSize: "12px", color: colors.deepGreen, fontWeight: 600, marginTop: "6px", display: "inline-block", cursor: "pointer", textDecoration: "underline" }}
                  >
                    {fix.label} →
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// =====================================================================
// Benchmark + trend
// =====================================================================

function BenchmarkStrip() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const benchmarks = useQuery(api.incomeResilience.listIncomeResilienceBenchmarks, {}) as any[] | undefined;
  const benchmark = benchmarks?.[0];
  if (!benchmark) return null;
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
        <div>
          <div style={{ fontSize: "12.5px", color: colors.inkSoft }}>{benchmark.label}</div>
          <div style={{ fontSize: "11px", color: colors.inkSoft }}>
            Source: {benchmark.sourceLabel}, retrieved {dayMonth(benchmark.fetchedAt)}
          </div>
        </div>
        <div style={{ fontFamily: fontSerif, fontSize: "16px", color: colors.deepGreen, whiteSpace: "nowrap" }}>
          {benchmark.recommendedMonths ? `${benchmark.recommendedMonths} months` : "See detail"}
        </div>
      </div>
    </Card>
  );
}

function TrendCard() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshots = useQuery(api.incomeResilience.listMySnapshots, {}) as any[] | undefined;
  if (!snapshots || snapshots.length === 0) return null;
  const recent = snapshots.slice(-8);
  const heightFor: Record<Tier, number> = { atRisk: 40, worthALook: 26, resilient: 12 };
  const last = recent[recent.length - 1];
  const prev = recent.length > 1 ? recent[recent.length - 2] : null;
  return (
    <Card>
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft, marginBottom: "10px" }}>Trend</div>
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "46px" }}>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {recent.map((s: any) => (
            <div key={s._id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <div style={{ width: "10px", borderRadius: "3px 3px 0 0", background: TIER_COLOR[s.tier as Tier], height: `${heightFor[s.tier as Tier]}px` }} />
              <div style={{ fontSize: "9px", color: colors.inkSoft }}>{dayMonth(s.generatedAt).replace(/, \d{4}/, "")}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: "12.5px", color: colors.inkSoft }}>
          {prev && prev.tier !== last.tier
            ? `Went from ${TIER_LABEL[prev.tier as Tier].toLowerCase()} to ${TIER_LABEL[last.tier as Tier].toLowerCase()}.`
            : `Steady at ${TIER_LABEL[last.tier as Tier].toLowerCase()} across recent checks.`}
        </div>
      </div>
    </Card>
  );
}

// =====================================================================
// Action row
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActionRow({ result }: { result: any }) {
  const send = useAction(api.incomeResilience.emailResilienceSummary);
  const [emailBusy, setEmailBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const status = useQuery(api.incomeResilience.emailResilienceSendStatus, outboundId ? { outboundId } : "skip");

  const requestConsult = useMutation(api.humanConsult.requestHumanConsult);
  const [askLogged, setAskLogged] = useState(false);
  const [consultLogged, setConsultLogged] = useState(false);
  const [consultBusy, setConsultBusy] = useState<"ask" | "consult" | null>(null);

  const logTicket = (kind: "ask" | "consult") => {
    setConsultBusy(kind);
    void requestConsult({
      sourceService: "incomeResilience",
      sourceEntityId: "resilience-check",
      topic: kind === "ask" ? `Question about income resilience: ${result.narration.headline}` : result.narration.headline,
    })
      .then(() => (kind === "ask" ? setAskLogged(true) : setConsultLogged(true)))
      .finally(() => setConsultBusy(null));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          style={primaryButtonStyle}
          disabled={emailBusy}
          onClick={() => {
            setEmailBusy(true);
            setEmailError(null);
            void send({ narration: result.narration, tier: result.tier, weakDimensions: (result.weakDimensions as { key: string }[]).map((d) => d.key) })
              .then((r) => {
                if (r.status === "sent" && r.outboundId) setOutboundId(r.outboundId);
                else setEmailError(r.detail);
              })
              .catch((err: Error) => setEmailError(err.message))
              .finally(() => setEmailBusy(false));
          }}
        >
          {emailBusy ? "Sending…" : "Email me this summary"}
        </button>
        <button style={ghostButtonStyle} disabled={consultBusy !== null || askLogged} onClick={() => logTicket("ask")}>
          {askLogged ? "Question logged ✓" : consultBusy === "ask" ? "…" : "Still stuck? Ask a question"}
        </button>
        <button style={ghostButtonStyle} disabled={consultBusy !== null || consultLogged} onClick={() => logTicket("consult")}>
          {consultLogged ? "Interest logged ✓" : consultBusy === "consult" ? "…" : "Want a real person's opinion?"}
        </button>
      </div>
      {outboundId && (
        <span style={{ fontSize: "11px", color: colors.inkSoft }}>
          {status === undefined ? "Checking delivery…" : `Delivery: ${(status as { status?: string } | null)?.status ?? "unknown"}`}
        </span>
      )}
      {emailError && <span style={{ fontSize: "11px", color: "#a13d3d" }}>{emailError}</span>}
      {(askLogged || consultLogged) && <span style={{ fontSize: "11px", color: colors.inkSoft }}>This logs a real ticket only — it doesn&rsquo;t book or schedule anyone.</span>}
    </div>
  );
}
