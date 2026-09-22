import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, CollapsibleSection, ghostButtonStyle, inputStyle, primaryButtonStyle } from "../goalPlanning/kit";
import { useCurrency } from "../../lib/currency";

// =====================================================================
// Investment & Risk Planning. This service NEVER recommends a specific
// investment or promises a return — it shows CAPACITY (Investment
// Readiness) and RANGES under a stated assumption (Goal-Based
// Scenarios), plus a standalone tax-bracket estimate and general,
// non-product asset-category education. Every number rendered here
// comes straight off a real backend response.
// =====================================================================

const dayMonth = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const caps: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: colors.inkSoft,
  margin: "0 0 8px",
};
const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };

const READINESS_BADGE: Record<string, string> = {
  NO_SURPLUS_YET: "No surplus yet",
  LIMITED_CAPACITY: "Limited capacity",
  MODERATE_CAPACITY: "Moderate capacity",
  STRONG_CAPACITY: "Strong capacity",
  INSUFFICIENT_DATA: "Insufficient data",
};

const SUGGESTION_CHIPS = [
  "How much can I safely invest right now?",
  "I have ₹10,000/month leftover - what could that become?",
  "What should I invest in to save on taxes?",
];

type ResultBundle = {
  question: string;
  route: "investmentReadiness" | "goalBasedScenario" | "taxBracketEstimate";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  deferralNote?: string;
  defaultHorizonYearsUsed?: number;
  askedAt: number;
};

export function InvestmentScreen() {
  const [result, setResult] = useState<ResultBundle | null>(null);
  // Fallback identifier for "Want a real person's opinion?" when a result
  // has no natural entity id of its own (the tax route, or a scenario/
  // readiness cache-hit row missing its insert id) — logging against the
  // household is still meaningful and never undefined.
  const mine = useQuery(api.households.getMine);
  const householdId = mine?.household._id ?? "";

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        {result ? (
          <ResultScreen bundle={result} onBack={() => setResult(null)} onAskAgain={(bundle) => setResult(bundle)} householdId={householdId} />
        ) : (
          <MainScreen onResult={setResult} />
        )}
      </div>
    </main>
  );
}

// =====================================================================
// Main screen — ask box + suggestion chips + category education.
// =====================================================================

function MainScreen({ onResult }: { onResult: (bundle: ResultBundle) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useAction(api.investment.askInvestmentQuestion);

  const submit = (q: string) => {
    const text = q.trim();
    if (text === "") return;
    setBusy(true);
    setError(null);
    void ask({ question: text })
      .then((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bundle = r as any;
        onResult({
          question: text,
          route: bundle.route,
          result: bundle.result,
          deferralNote: bundle.deferralNote,
          defaultHorizonYearsUsed: bundle.defaultHorizonYearsUsed,
          askedAt: Date.now(),
        });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div>
        <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>Investment &amp; Risk Planning</h1>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>
          Understand what you can afford to set aside, and what it could mean over time — not what to buy.
        </div>
      </div>

      <Card>
        <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>How much do you have, and what's it for?</div>
        <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
          Tell us in your own words — we'll figure out the right answer for you.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={f}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(question)}
            placeholder="e.g. I have some money left over each month, what should I do with it?"
          />
          <button style={primaryButtonStyle} disabled={busy || question.trim() === ""} onClick={() => submit(question)}>
            {busy ? "…" : "Ask"}
          </button>
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              disabled={busy}
              onClick={() => {
                setQuestion(chip);
                submit(chip);
              }}
              style={{
                fontFamily: fontSans,
                fontSize: "12px",
                color: colors.deepGreen,
                background: "#ffffff",
                border: `1px solid ${colors.sageGreen}`,
                borderRadius: "16px",
                padding: "6px 12px",
                cursor: "pointer",
              }}
            >
              {chip}
            </button>
          ))}
        </div>
        {error && <p style={{ color: "#a13d3d", fontSize: "12px", marginTop: "8px" }}>{error}</p>}
      </Card>

      <AssetCategoryGrid />
    </>
  );
}

// =====================================================================
// Result screen — shared shell for all 3 routes.
// =====================================================================

function ResultScreen({
  bundle,
  onBack,
  onAskAgain,
  householdId,
}: {
  bundle: ResultBundle;
  onBack: () => void;
  onAskAgain: (bundle: ResultBundle) => void;
  householdId: string;
}) {
  return (
    <>
      <span onClick={onBack} style={{ fontSize: "13px", color: colors.deepGreen, cursor: "pointer", textDecoration: "underline" }}>
        ← Ask something else
      </span>
      <div style={{ fontSize: "13px", color: colors.inkSoft, fontStyle: "italic" }}>&ldquo;{bundle.question}&rdquo;</div>

      {bundle.route === "investmentReadiness" && <ReadinessResult bundle={bundle} onAskAgain={onAskAgain} onBack={onBack} householdId={householdId} />}
      {bundle.route === "goalBasedScenario" && <ScenarioResult bundle={bundle} onAskAgain={onAskAgain} onBack={onBack} householdId={householdId} />}
      {bundle.route === "taxBracketEstimate" && <TaxResult bundle={bundle} onAskAgain={onAskAgain} onBack={onBack} householdId={householdId} />}
    </>
  );
}

function BoundaryBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#F5EBD8",
        border: "1px dashed #8A6D3B",
        borderRadius: radius,
        padding: "12px 14px",
        fontSize: "12.5px",
        color: colors.ink,
      }}
    >
      <strong style={{ color: "#8A6D3B" }}>What this is, and isn't</strong>
      <div style={{ marginTop: "4px" }}>{children}</div>
    </div>
  );
}

function ActionRow({
  narration,
  deterministic,
  onAskAgain,
  question,
  route,
  sourceEntityId,
}: {
  narration: { headline: string; plainLanguage: string; caveats: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deterministic: any;
  onAskAgain: (bundle: ResultBundle) => void;
  question: string;
  route: ResultBundle["route"];
  sourceEntityId: string;
}) {
  const [askOpen, setAskOpen] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const ask = useAction(api.investment.askInvestmentQuestion);
  const [busy, setBusy] = useState(false);
  const requestConsult = useMutation(api.humanConsult.requestHumanConsult);
  const [consultBusy, setConsultBusy] = useState(false);
  const [consultLogged, setConsultLogged] = useState(false);
  const [consultError, setConsultError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <EmailSummaryButton narration={narration} deterministic={deterministic} />
        <button style={ghostButtonStyle} onClick={() => setAskOpen((v) => !v)}>
          Still stuck? Ask a question
        </button>
        <button
          style={ghostButtonStyle}
          disabled={consultBusy || consultLogged}
          onClick={() => {
            setConsultBusy(true);
            setConsultError(null);
            void requestConsult({ sourceService: "investment", sourceEntityId, topic: question })
              .then(() => setConsultLogged(true))
              .catch((err: Error) => setConsultError(err.message))
              .finally(() => setConsultBusy(false));
          }}
        >
          {consultLogged ? "Interest logged ✓" : consultBusy ? "…" : "Want a real person's opinion?"}
        </button>
      </div>
      {consultLogged && (
        <div style={{ fontSize: "11px", color: colors.inkSoft }}>
          This logs your interest only — it does not book or schedule an expert.
        </div>
      )}
      {consultError && <div style={{ fontSize: "11px", color: "#a13d3d" }}>{consultError}</div>}
      {askOpen && (
        <div style={{ display: "flex", gap: "8px" }}>
          <input style={f} value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="What's still unclear?" />
          <button
            style={primaryButtonStyle}
            disabled={busy || followUp.trim() === ""}
            onClick={() => {
              setBusy(true);
              void ask({ question: followUp })
                .then((r) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const b = r as any;
                  onAskAgain({
                    question: followUp,
                    route: b.route,
                    result: b.result,
                    deferralNote: b.deferralNote,
                    defaultHorizonYearsUsed: b.defaultHorizonYearsUsed,
                    askedAt: Date.now(),
                  });
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
      )}
      <div style={{ display: "none" }}>{question + route}</div>
    </div>
  );
}

// =====================================================================
// Investment Readiness result
// =====================================================================

function ReadinessResult({
  bundle,
  onAskAgain,
  onBack,
  householdId,
}: {
  bundle: ResultBundle;
  onAskAgain: (bundle: ResultBundle) => void;
  onBack: () => void;
  householdId: string;
}) {
  const { format } = useCurrency();
  const r = bundle.result;
  if (!r) return <Card>Something went wrong generating this result.</Card>;
  const badge = READINESS_BADGE[r.readinessState] ?? r.readinessState;

  return (
    <>
      <div style={{ background: colors.deepGreen, color: colors.cream, borderRadius: radius, padding: "16px 20px" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            background: "rgba(255,255,255,0.18)",
            borderRadius: "10px",
            padding: "3px 10px",
            marginBottom: "8px",
          }}
        >
          {badge}
        </span>
        <div style={{ fontSize: "15px", lineHeight: 1.4 }}>{r.narration.headline}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
        <StatCard label="Investable surplus" value={format(r.investableSurplusMinorUnits)} />
        <StatCard label="Liquid reserve" value={format(r.eligibleLiquidReserveMinorUnits)} />
        <StatCard label="Reserve target" value={format(r.emergencyReserveTargetMinorUnits)} />
      </div>

      <CollapsibleSection title="How this was calculated" defaultOpen>
        <LineItem label="Eligible liquid reserve" value={format(r.eligibleLiquidReserveMinorUnits)} />
        <LineItem label="− Emergency reserve target" value={format(r.emergencyReserveTargetMinorUnits)} />
        <LineItem label="− Earmarked for goals" value={format(r.earmarkedForGoalsMinorUnits)} />
        <LineItem label="= Investable surplus" value={format(r.investableSurplusMinorUnits)} bold />
        {r.calculationExplanation && (
          <p style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "10px", fontStyle: "italic" }}>{r.calculationExplanation}</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="What would change this answer" defaultOpen={false}>
        <ul style={{ fontSize: "13px", margin: 0, paddingLeft: "18px" }}>
          {(r.whatWouldChange as string[]).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="What this doesn't tell you" defaultOpen={false}>
        <ul style={{ fontSize: "13px", margin: 0, paddingLeft: "18px" }}>
          {(r.whatThisDoesntTell as string[]).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </CollapsibleSection>

      <BoundaryBox>
        This shows how much risk your finances could currently absorb — it is not a recommendation to invest a specific amount, and it
        doesn't tell you what to invest in.
      </BoundaryBox>

      <ActionRow
        narration={r.narration}
        deterministic={r}
        onAskAgain={onAskAgain}
        question={bundle.question}
        route={bundle.route}
        sourceEntityId={r.checkId ?? householdId}
      />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Based on your current Financial Foundation and Goal &amp; Situation Planning data, calculated {dayMonth(bundle.askedAt)}.
        {r._fromCache && " (shown from a saved calculation)"}
      </p>
      <span onClick={onBack} style={{ display: "none" }} />
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div style={{ ...caps, margin: "0 0 4px" }}>{label}</div>
      <div style={{ fontFamily: fontSerif, fontSize: "20px", color: colors.deepGreen }}>{value}</div>
    </Card>
  );
}

function LineItem({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", padding: "4px 0", fontWeight: bold ? 700 : 400, color: bold ? colors.deepGreen : colors.ink }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// =====================================================================
// Goal-Based Scenario result
// =====================================================================

function ScenarioResult({
  bundle,
  onAskAgain,
  onBack,
  householdId,
}: {
  bundle: ResultBundle;
  onAskAgain: (bundle: ResultBundle) => void;
  onBack: () => void;
  householdId: string;
}) {
  const { format } = useCurrency();
  const r = bundle.result;
  if (r?.needsInput) {
    return (
      <Card>
        <p style={{ fontSize: "13px", margin: 0 }}>{r.reason}</p>
      </Card>
    );
  }
  if (!r || r.error) {
    return (
      <Card>
        <p style={{ fontSize: "13px", color: "#a13d3d", margin: 0 }}>{r?.error ?? "Something went wrong generating this scenario."}</p>
      </Card>
    );
  }

  return (
    <>
      <div style={{ background: colors.deepGreen, color: colors.cream, borderRadius: radius, padding: "16px 20px" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            background: "rgba(255,255,255,0.18)",
            borderRadius: "10px",
            padding: "3px 10px",
            marginBottom: "8px",
          }}
        >
          Projected range — assumption, not a promise
        </span>
        <div style={{ fontSize: "15px", lineHeight: 1.4 }}>{r.narration.headline}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px" }}>
        <StatCard label="Projected range — low" value={format(r.projectedRangeLowMinorUnits)} />
        <StatCard label="Projected range — high" value={format(r.projectedRangeHighMinorUnits)} />
      </div>

      <CollapsibleSection title="How this was calculated" defaultOpen>
        <LineItem label="Monthly contribution" value={format(r.monthlyContributionMinorUnits)} />
        <LineItem label="Horizon" value={`${r.horizonYears} years`} />
        <LineItem label="Assumed annual return range" value={`${r.assumedAnnualReturnRangeLow}%–${r.assumedAnnualReturnRangeHigh}%`} />
        <p style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "10px", fontStyle: "italic" }}>{r.assumptionSourceNote}</p>
        {bundle.defaultHorizonYearsUsed !== undefined && (
          <p style={{ fontSize: "12px", color: colors.inkSoft }}>
            No horizon was stated, so a {bundle.defaultHorizonYearsUsed}-year default was used — change it by asking again with a horizon
            in mind.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="What this doesn't tell you" defaultOpen={false}>
        <ul style={{ fontSize: "13px", margin: 0, paddingLeft: "18px" }}>
          {(r.narration.caveats as string[]).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </CollapsibleSection>

      <BoundaryBox>
        This is a range of what a monthly contribution could become under a stated assumed return — not a forecast, not a guarantee, and
        not a recommendation of what to invest in.
      </BoundaryBox>

      <ActionRow
        narration={r.narration}
        deterministic={r}
        onAskAgain={onAskAgain}
        question={bundle.question}
        route={bundle.route}
        sourceEntityId={r.scenarioId ?? r._id ?? householdId}
      />
      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Calculated {dayMonth(bundle.askedAt)}.{r._fromCache && " (shown from a saved calculation)"}
      </p>
      <span onClick={onBack} style={{ display: "none" }} />
    </>
  );
}

// =====================================================================
// Tax bracket result
// =====================================================================

function TaxResult({
  bundle,
  onAskAgain,
  onBack,
  householdId,
}: {
  bundle: ResultBundle;
  onAskAgain: (bundle: ResultBundle) => void;
  onBack: () => void;
  householdId: string;
}) {
  const { format } = useCurrency();
  const r = bundle.result;
  if (!r || r.state !== "COMPUTED") {
    return (
      <Card>
        <p style={{ fontSize: "13px", color: "#a15c1e", margin: 0 }}>{r?.reason ?? "This estimate isn't available right now."}</p>
      </Card>
    );
  }
  return (
    <>
      <div style={{ background: colors.deepGreen, color: colors.cream, borderRadius: radius, padding: "16px 20px" }}>
        <span
          style={{
            display: "inline-block",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            background: "rgba(255,255,255,0.18)",
            borderRadius: "10px",
            padding: "3px 10px",
            marginBottom: "8px",
          }}
        >
          {r.estimatedSlabLabel}
        </span>
        <div style={{ fontSize: "15px", lineHeight: 1.4 }}>{r.narration.headline}</div>
      </div>
      <Card>
        <LineItem label="Dependable annual income" value={format(r.annualIncomeMinorUnits)} />
        <LineItem label="Estimated slab" value={`${r.estimatedSlabLabel} (${r.ratePercent}%)`} bold />
        <p style={{ fontSize: "13px", margin: "10px 0 0" }}>{r.narration.plainLanguage}</p>
        <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "8px" }}>
          Source:{" "}
          <a href={r.sourceUrl} target="_blank" rel="noreferrer">
            {r.sourceLabel}
          </a>
          {r.fromCache && " · from cache"}
        </div>
      </Card>
      {bundle.deferralNote && (
        <div style={{ fontSize: "12px", color: colors.inkSoft, background: colors.creamDim, borderRadius: radius, padding: "10px 12px" }}>
          {bundle.deferralNote}
        </div>
      )}
      <BoundaryBox>This is a current-slab estimate only, not tax advice and not a recommendation of what to invest in to reduce it.</BoundaryBox>
      <ActionRow
        narration={{ headline: r.narration.headline, plainLanguage: r.narration.plainLanguage, caveats: r.narration.caveats ?? [] }}
        deterministic={r}
        onAskAgain={onAskAgain}
        question={bundle.question}
        route={bundle.route}
        sourceEntityId={householdId}
      />
      <span onClick={onBack} style={{ display: "none" }} />
    </>
  );
}

// =====================================================================
// Asset category education — auto-loaded, general, non-product.
// =====================================================================

const CATEGORY_LABELS: [string, string][] = [
  ["fixedDeposit", "Fixed Deposit"],
  ["indexFund", "Index Fund"],
  ["ppf", "PPF"],
  ["governmentBond", "Government Bond"],
  ["mutualFund", "Mutual Fund"],
  ["gold", "Gold"],
];

function AssetCategoryGrid() {
  const refresh = useAction(api.investment.refreshAssetCategoryReference);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = useQuery(api.investment.listAssetCategoryReferences, {}) as any[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [loaded, setLoaded] = useState<Record<string, any>>({});

  useEffect(() => {
    if (cached === undefined) return;
    for (const [key] of CATEGORY_LABELS) {
      const already = cached.find((c) => c.category === key);
      if (already) {
        setLoaded((prev) => (prev[key] ? prev : { ...prev, [key]: already }));
      } else {
        void refresh({ category: key as never }).then((r) => setLoaded((prev) => ({ ...prev, [key]: r })));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cached === undefined]);

  return (
    <div>
      <div style={caps}>General categories, explained (not a recommendation)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
        {CATEGORY_LABELS.map(([key, label]) => {
          const item = loaded[key];
          return (
            <Card key={key}>
              <div style={{ fontWeight: 700, fontSize: "14px", color: colors.deepGreen, marginBottom: "4px" }}>{label}</div>
              {item ? (
                <>
                  <div style={{ fontSize: "12.5px" }}>{item.description}</div>
                  <div style={{ fontSize: "10.5px", color: colors.inkSoft, marginTop: "6px" }}>
                    Source: {item.usedGenericFallback ? "general investor education" : item.sourceLabel ?? "general investor education"},
                    retrieved {dayMonth(item.fetchedAt ?? Date.now())}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "12px", color: colors.inkSoft }}>loading…</div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// "Email me a summary" — same pattern as Loan & Debt / Side-Income.
// =====================================================================

function EmailSummaryButton({
  narration,
  deterministic,
}: {
  narration: { headline: string; plainLanguage: string; caveats: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deterministic: any;
}) {
  const send = useAction(api.investment.emailInvestmentSummary);
  const [busy, setBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const status = useQuery(api.investment.emailSendStatus, outboundId ? { outboundId } : "skip");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
      <button
        style={ghostButtonStyle}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailMessage(null);
          void send({ narration: { headline: narration.headline, plainLanguage: narration.plainLanguage, caveats: narration.caveats }, deterministic })
            .then((r) => {
              if (r.status === "sent" && r.outboundId) setOutboundId(r.outboundId);
              else setFailMessage(r.detail);
            })
            .catch((err: Error) => setFailMessage(err.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Sending…" : "✉ Email me a summary"}
      </button>
      {outboundId && (
        <span style={{ fontSize: "11px", color: colors.inkSoft }}>
          {status === undefined ? "Checking delivery…" : `Delivery: ${(status as { status?: string } | null)?.status ?? "unknown"}`}
        </span>
      )}
      {failMessage && <span style={{ fontSize: "11px", color: "#a13d3d" }}>{failMessage}</span>}
    </div>
  );
}
