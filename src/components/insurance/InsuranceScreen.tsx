import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, CollapsibleSection, ghostButtonStyle, inputStyle, primaryButtonStyle } from "../goalPlanning/kit";

// =====================================================================
// Insurance, Protection & Financial Rights. This service explains
// categories and names gaps — it NEVER recommends a specific insurer,
// product, or premium quote. "You appear underinsured by X" is a
// deterministic, data-backed observation; "buy policy Y from insurer Z"
// is never something this service says. Every number rendered here
// comes straight off a real backend response.
// =====================================================================

const rupee = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? "—" : `₹${Math.round(minor).toLocaleString("en-IN")}`;

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

// Same amber used elsewhere in the app (Loan & Debt's NEEDS_HUMAN_REVIEW
// state) for a caution banner — not a new color introduced here.
const AMBER = "#8A6D1F";
const SIGNIFICANT_RED = "#A13D3D";

const SUGGESTION_CHIPS = ["Is my coverage enough?", "Can I switch insurers?", "What am I missing entirely?"];

const HEALTH_ASSESSMENT_LABEL: Record<string, string> = {
  NONE: "No health cover on file",
  LIKELY_INSUFFICIENT: "Health cover likely insufficient",
  LIKELY_ADEQUATE: "Health cover likely adequate",
  INSUFFICIENT_DATA: "Not enough data to assess health cover",
};

type ResultBundle = {
  question: string;
  route: "adequacyCheck" | "portabilityGuide" | "gapDetection";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  askedAt: number;
};

export function InsuranceScreen({ onNavigateToFinancialFoundation }: { onNavigateToFinancialFoundation?: () => void }) {
  const [result, setResult] = useState<ResultBundle | null>(null);
  const mine = useQuery(api.households.getMine);
  const householdId = mine?.household._id ?? "";

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        {result ? (
          <ResultScreen
            bundle={result}
            onBack={() => setResult(null)}
            onAskAgain={(bundle) => setResult(bundle)}
            householdId={householdId}
          />
        ) : (
          <MainScreen onResult={setResult} onNavigateToFinancialFoundation={onNavigateToFinancialFoundation} />
        )}
      </div>
    </main>
  );
}

// =====================================================================
// Main screen — policy summary bar + ask box + category education.
// =====================================================================

function MainScreen({
  onResult,
  onNavigateToFinancialFoundation,
}: {
  onResult: (bundle: ResultBundle) => void;
  onNavigateToFinancialFoundation?: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useAction(api.insuranceRiskPlanning.askInsuranceQuestion);

  const submit = (q: string) => {
    const text = q.trim();
    if (text === "") return;
    setBusy(true);
    setError(null);
    void ask({ question: text })
      .then((r) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bundle = r as any;
        onResult({ question: text, route: bundle.route, result: bundle.result, askedAt: Date.now() });
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div>
        <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>Insurance, Protection &amp; Financial Rights</h1>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>
          Understand what you have, what it means, and where you might be exposed — never what to buy.
        </div>
      </div>

      <PolicySummaryBar onNavigateToFinancialFoundation={onNavigateToFinancialFoundation} />

      <Card>
        <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>What do you want to know?</div>
        <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
          Ask in your own words — we'll figure out the right answer for you.
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            style={f}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit(question)}
            placeholder="e.g. Is my health cover actually enough?"
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

      <InsuranceCategoryGrid />
    </>
  );
}

const INSURANCE_TYPE_LABEL: Record<string, string> = {
  life: "Life",
  health: "Health",
  motor: "Motor",
  property: "Property",
  personalAccident: "Personal Accident",
  other: "Other",
};

function PolicySummaryBar({ onNavigateToFinancialFoundation }: { onNavigateToFinancialFoundation?: () => void }) {
  const policies = useQuery(api.insurance.listInsurancePolicies);
  if (policies === undefined) {
    return (
      <Card>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>Loading your policies…</div>
      </Card>
    );
  }
  const types = [...new Set(policies.map((p) => INSURANCE_TYPE_LABEL[p.type] ?? p.type))];
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ fontSize: "13px" }}>
          You have <strong>{policies.length}</strong> {policies.length === 1 ? "policy" : "policies"} on file
          {types.length > 0 && ` (${types.join(", ")})`}
        </div>
        <span
          onClick={onNavigateToFinancialFoundation}
          style={{ fontSize: "13px", color: colors.deepGreen, textDecoration: "underline", cursor: onNavigateToFinancialFoundation ? "pointer" : "default" }}
        >
          View in Financial Foundation →
        </span>
      </div>
    </Card>
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

      {bundle.route === "adequacyCheck" && <AdequacyResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
      {bundle.route === "portabilityGuide" && <PortabilityResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
      {bundle.route === "gapDetection" && <GapResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
    </>
  );
}

function VerdictBanner({ tone, badge, headline }: { tone: "green" | "amber"; badge: string; headline: string }) {
  return (
    <div style={{ background: tone === "amber" ? AMBER : colors.deepGreen, color: colors.cream, borderRadius: radius, padding: "16px 20px" }}>
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
      <div style={{ fontSize: "15px", lineHeight: 1.4 }}>{headline}</div>
    </div>
  );
}

function CaveatBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#F5EBD8",
        border: `1px dashed ${AMBER}`,
        borderRadius: radius,
        padding: "12px 14px",
        fontSize: "12.5px",
        color: colors.ink,
      }}
    >
      <strong style={{ color: AMBER }}>What this is, and isn't</strong>
      <div style={{ marginTop: "4px" }}>{children}</div>
    </div>
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
  const ask = useAction(api.insuranceRiskPlanning.askInsuranceQuestion);
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
            void requestConsult({ sourceService: "insurance", sourceEntityId, topic: question })
              .then(() => setConsultLogged(true))
              .catch((err: Error) => setConsultError(err.message))
              .finally(() => setConsultBusy(false));
          }}
        >
          {consultLogged ? "Interest logged ✓" : consultBusy ? "…" : "Want a real person's opinion?"}
        </button>
      </div>
      {consultLogged && (
        <div style={{ fontSize: "11px", color: colors.inkSoft }}>This logs your interest only — it does not book or schedule an expert.</div>
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
                  onAskAgain({ question: followUp, route: b.route, result: b.result, askedAt: Date.now() });
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
// Adequacy check result
// =====================================================================

function AdequacyResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
  const r = bundle.result;
  if (!r) return <Card>Something went wrong generating this result.</Card>;

  const effectiveLifeCover = r.totalLifeCoverageMinorUnits + r.bundledLifeCoverageMinorUnits;
  const lifeGapIsPositive = r.lifeCoverageGapMinorUnits > 0;
  const healthIsGap = r.healthCoverageAssessment === "NONE" || r.healthCoverageAssessment === "LIKELY_INSUFFICIENT";
  const isAmber = lifeGapIsPositive || healthIsGap;
  const badge = lifeGapIsPositive ? "LIFE COVER GAP FOUND" : healthIsGap ? "HEALTH COVER GAP FOUND" : "COVERAGE LOOKS ADEQUATE";

  return (
    <>
      <VerdictBanner tone={isAmber ? "amber" : "green"} badge={badge} headline={r.narration.headline} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
        <StatCard label="Current life cover" value={rupee(effectiveLifeCover)} />
        <StatCard label="Estimated need" value={rupee(r.estimatedLifeCoverNeededMinorUnits)} />
        <StatCard label={r.lifeCoverageGapMinorUnits >= 0 ? "Gap" : "Surplus"} value={rupee(Math.abs(r.lifeCoverageGapMinorUnits))} />
      </div>

      <CollapsibleSection title="How this was calculated" defaultOpen>
        <LineItem label="Outstanding loan balance" value={rupee(r.outstandingLoanBalanceMinorUnits)} />
        <LineItem
          label={`+ ${r.lifeIncomeReplacementYears} years × dependable annual income (${rupee(r.dependableAnnualIncomeMinorUnits)})`}
          value={rupee(r.lifeIncomeReplacementYears * r.dependableAnnualIncomeMinorUnits)}
        />
        <LineItem label="= Estimated need" value={rupee(r.estimatedLifeCoverNeededMinorUnits)} bold />
        <div style={{ height: "8px" }} />
        <LineItem label="Life cover on file" value={rupee(r.totalLifeCoverageMinorUnits)} />
        <LineItem label="+ Bundled loan-linked cover" value={rupee(r.bundledLifeCoverageMinorUnits)} />
        <LineItem label="= Current life cover" value={rupee(effectiveLifeCover)} bold />
        <div style={{ height: "8px" }} />
        <LineItem label="Health cover on file" value={rupee(r.totalHealthCoverageMinorUnits)} />
        <LineItem label="Commonly-cited minimum (household size)" value={rupee(r.healthCoverMinimumMinorUnits)} />
        <LineItem label="Health assessment" value={HEALTH_ASSESSMENT_LABEL[r.healthCoverageAssessment] ?? r.healthCoverageAssessment} bold />
        <p style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "10px", fontStyle: "italic" }}>{r.narration.plainLanguage}</p>
      </CollapsibleSection>

      <CaveatBox>
        This is an estimate using a commonly-cited formula (outstanding debt + {r.lifeIncomeReplacementYears} years of income), not a
        personalized recommendation. It does not tell you what policy or insurer to choose.
      </CaveatBox>

      {r.narration.caveats.length > 0 && (
        <ul style={{ fontSize: "12px", color: colors.inkSoft, margin: 0, paddingLeft: "18px" }}>
          {(r.narration.caveats as string[]).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      <ActionRow narration={r.narration} deterministic={r} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={r.checkId ?? householdId} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Based on your current Financial Foundation, Loan &amp; Debt, and Goal &amp; Situation Planning data, calculated {dayMonth(bundle.askedAt)}.
        {r._fromCache && " (shown from a saved calculation)"}
      </p>
    </>
  );
}

// =====================================================================
// Portability guidance result
// =====================================================================

function PortabilityResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
  const r = bundle.result;
  if (!r || r.state !== "COMPUTED") {
    return (
      <Card>
        <p style={{ fontSize: "13px", color: "#a15c1e", margin: 0 }}>{r?.reason ?? "This guidance isn't available right now."}</p>
      </Card>
    );
  }
  const steps = r.steps as { title: string; detail: string }[];
  // Synthetic narration built from real step data — this route has no
  // AI narration object of its own (regulatory steps are shown
  // verbatim, never narrated), but "email me a summary" still needs
  // something to send; every word here comes from the real steps.
  const narration = {
    headline: `Health Insurance Portability Process (${steps.length} steps)`,
    plainLanguage: steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`).join("\n"),
    caveats: [] as string[],
  };

  return (
    <>
      <VerdictBanner tone="green" badge="PORTABILITY PROCESS" headline={`How to switch ${r.insuranceType} insurers, per the official process`} />

      <CollapsibleSection title="The portability process" defaultOpen>
        {steps.map((s, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: i < steps.length - 1 ? `1px solid ${colors.creamDim}` : "none" }}>
            <div style={{ fontWeight: 700, fontSize: "13px", color: colors.deepGreen }}>
              {i + 1}. {s.title}
            </div>
            <div style={{ fontSize: "12.5px", marginTop: "2px" }}>{s.detail}</div>
          </div>
        ))}
      </CollapsibleSection>

      <ActionRow narration={narration} deterministic={{}} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={householdId} />

      {r.sourceLabel && r.sourceUrl && (
        <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
          Source:{" "}
          <a href={r.sourceUrl} target="_blank" rel="noreferrer">
            {r.sourceLabel}
          </a>
          {r._fromCache && " · from a saved fetch"}
        </p>
      )}
    </>
  );
}

// =====================================================================
// Gap detection result
// =====================================================================

const SEVERITY_LABEL: Record<string, string> = { significant: "Significant", notable: "Notable" };

function GapResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
  const r = bundle.result;
  if (!r) return <Card>Something went wrong generating this result.</Card>;
  const gaps = r.gaps as { gapType: string; description: string; severity: "notable" | "significant" }[];
  const hasSignificant = gaps.some((g) => g.severity === "significant");
  const isAmber = gaps.length > 0;
  const badge = gaps.length === 0 ? "NO GAPS FOUND" : hasSignificant ? "SIGNIFICANT GAPS FOUND" : "GAPS FOUND";

  return (
    <>
      <VerdictBanner tone={isAmber ? "amber" : "green"} badge={badge} headline={r.narration.headline} />

      <CollapsibleSection title="Details" defaultOpen>
        {gaps.length === 0 ? (
          <p style={{ fontSize: "13px", margin: 0 }}>{r.narration.plainLanguage}</p>
        ) : (
          gaps.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", padding: "8px 0", borderBottom: i < gaps.length - 1 ? `1px solid ${colors.creamDim}` : "none" }}>
              <span
                style={{
                  flexShrink: 0,
                  marginTop: "5px",
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: g.severity === "significant" ? SIGNIFICANT_RED : AMBER,
                }}
              />
              <div>
                <div style={{ fontWeight: g.severity === "significant" ? 700 : 600, fontSize: "13px", color: g.severity === "significant" ? SIGNIFICANT_RED : colors.ink }}>
                  {SEVERITY_LABEL[g.severity]}
                </div>
                <div style={{ fontSize: "12.5px", marginTop: "2px" }}>{g.description}</div>
              </div>
            </div>
          ))
        )}
      </CollapsibleSection>

      {r.narration.caveats.length > 0 && (
        <CaveatBox>
          <ul style={{ margin: 0, paddingLeft: "16px" }}>
            {(r.narration.caveats as string[]).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </CaveatBox>
      )}

      <ActionRow narration={r.narration} deterministic={r} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={r.detectionId ?? householdId} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Based on your current household data across services, calculated {dayMonth(bundle.askedAt)}.{r._fromCache && " (shown from a saved calculation)"}
      </p>
    </>
  );
}

// =====================================================================
// Category education — auto-loaded, general, non-product.
// =====================================================================

const CATEGORY_LABELS: [string, string][] = [
  ["life", "Life Insurance"],
  ["health", "Health Insurance"],
  ["motor", "Motor Insurance"],
  ["property", "Property Insurance"],
  ["personalAccident", "Personal Accident"],
  ["other", "Other"],
];

function InsuranceCategoryGrid() {
  const refresh = useAction(api.insuranceRiskPlanning.refreshInsuranceCategoryReference);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = useQuery(api.insuranceRiskPlanning.listInsuranceCategoryReferences, {}) as any[] | undefined;
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
                    Source: {item.usedGenericFallback ? "general insurance education" : item.sourceLabel ?? "general insurance education"}, retrieved{" "}
                    {dayMonth(item.fetchedAt ?? Date.now())}
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
// "Email me a summary" — same pattern as Investment / Loan & Debt.
// =====================================================================

function EmailSummaryButton({
  narration,
  deterministic,
}: {
  narration: { headline: string; plainLanguage: string; caveats: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deterministic: any;
}) {
  const send = useAction(api.insuranceRiskPlanning.emailInsuranceSummary);
  const [busy, setBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const status = useQuery(api.insuranceRiskPlanning.emailSendStatus, outboundId ? { outboundId } : "skip");

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
