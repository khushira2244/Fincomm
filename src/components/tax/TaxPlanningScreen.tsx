import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, CollapsibleSection, ghostButtonStyle, inputStyle, primaryButtonStyle } from "../goalPlanning/kit";
import { useCurrency } from "../../lib/currency";

// =====================================================================
// Tax Planning. Deterministic code does every calculation (deduction
// sums, caps, regime comparison) — OpenAI narrates only, and never
// says "file it this way" or claims a filing is correct. Every number
// rendered here comes straight off a real backend response. GST is
// informational only and never feeds any calculation.
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
const AMBER = "#8A6D1F";

const SUGGESTION_CHIPS = ["Am I paying more than I need to?", "Old regime or new regime — which is better?", "Have I used all my deductions?"];

type ResultBundle = {
  question: string;
  route: "deductionSummary" | "regimeComparison" | "taxSavingInvestments" | "deductionGaps";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  askedAt: number;
};

export function TaxPlanningScreen() {
  const [result, setResult] = useState<ResultBundle | null>(null);
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
// Main screen — tax profile + ask box + economic/policy context.
// =====================================================================

function MainScreen({ onResult }: { onResult: (bundle: ResultBundle) => void }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = useAction(api.taxPlanning.askTaxQuestion);

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
        <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>Tax Planning</h1>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>
          Understand your deductions and estimate your tax — not a filing, just a clearer picture.
        </div>
      </div>

      <TaxProfileCard />

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
            placeholder="e.g. Old regime or new regime, which is better for me?"
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

      <EconomicContextCard />
    </>
  );
}

// =====================================================================
// Tax profile card — direct honest input, wired to the real mutation.
// =====================================================================

function TaxProfileCard() {
  const profile = useQuery(api.taxPlanning.getTaxProfile, {});
  const save = useMutation(api.taxPlanning.saveTaxProfile);
  const [employmentType, setEmploymentType] = useState<"salaried" | "selfEmployed">("salaried");
  const [tds, setTds] = useState("");
  const [hra, setHra] = useState("");
  const [netBusinessIncome, setNetBusinessIncome] = useState("");
  const [investment80C, setInvestment80C] = useState("");
  const [gstRegistered, setGstRegistered] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (profile !== undefined && profile !== null && !loaded) {
    setLoaded(true);
    setEmploymentType(profile.employmentType);
    setTds(profile.approximateTdsDeductedMinorUnits !== undefined ? String(profile.approximateTdsDeductedMinorUnits) : "");
    setHra(profile.hraClaimedMinorUnits !== undefined ? String(profile.hraClaimedMinorUnits) : "");
    setNetBusinessIncome(profile.approximateNetBusinessIncomeMinorUnits !== undefined ? String(profile.approximateNetBusinessIncomeMinorUnits) : "");
    setInvestment80C(profile.approximate80CInvestmentMinorUnits !== undefined ? String(profile.approximate80CInvestmentMinorUnits) : "");
    setGstRegistered(profile.gstRegistered ?? false);
  }

  const submit = () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    void save({
      employmentType,
      approximateTdsDeductedMinorUnits: employmentType === "salaried" && tds.trim() !== "" ? Number(tds) : undefined,
      hraClaimedMinorUnits: employmentType === "salaried" && hra.trim() !== "" ? Number(hra) : undefined,
      approximateNetBusinessIncomeMinorUnits: employmentType === "selfEmployed" && netBusinessIncome.trim() !== "" ? Number(netBusinessIncome) : undefined,
      approximate80CInvestmentMinorUnits: investment80C.trim() !== "" ? Number(investment80C) : undefined,
      gstRegistered,
    })
      .then(() => setSaved(true))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const segmentBase: React.CSSProperties = {
    fontFamily: fontSans,
    fontSize: "13px",
    fontWeight: 600,
    padding: "8px 16px",
    border: `1px solid ${colors.deepGreen}`,
    cursor: "pointer",
  };

  return (
    <Card>
      <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>Your tax profile</div>
      <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
        A few honest approximate figures — we'll use what's already in FinComp for the rest.
      </div>

      <div style={{ display: "flex", marginBottom: "12px" }}>
        <button
          onClick={() => setEmploymentType("salaried")}
          style={{
            ...segmentBase,
            borderRadius: `${radius} 0 0 ${radius}`,
            background: employmentType === "salaried" ? colors.deepGreen : "#ffffff",
            color: employmentType === "salaried" ? colors.cream : colors.deepGreen,
          }}
        >
          Salaried
        </button>
        <button
          onClick={() => setEmploymentType("selfEmployed")}
          style={{
            ...segmentBase,
            borderLeft: "none",
            borderRadius: `0 ${radius} ${radius} 0`,
            background: employmentType === "selfEmployed" ? colors.deepGreen : "#ffffff",
            color: employmentType === "selfEmployed" ? colors.cream : colors.deepGreen,
          }}
        >
          Self-employed / Business
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px", alignItems: "end" }}>
        {employmentType === "salaried" ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: colors.inkSoft }}>
              Approximate TDS deducted so far (optional)
              <input style={f} value={tds} onChange={(e) => setTds(e.target.value)} placeholder="e.g. 40000" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: colors.inkSoft }}>
              HRA claimed (optional)
              <input style={f} value={hra} onChange={(e) => setHra(e.target.value)} placeholder="e.g. 60000" />
            </label>
          </>
        ) : (
          <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: colors.inkSoft, gridColumn: "span 2" }}>
            Net business income — after expenses, not revenue (optional)
            <input style={f} value={netBusinessIncome} onChange={(e) => setNetBusinessIncome(e.target.value)} placeholder="e.g. 800000" />
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: colors.inkSoft }}>
          Other 80C investments not tracked elsewhere (optional)
          <input style={f} value={investment80C} onChange={(e) => setInvestment80C(e.target.value)} placeholder="e.g. 50000 (PPF, ELSS, ...)" />
        </label>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: colors.ink, marginTop: "12px" }}>
        <input type="checkbox" checked={gstRegistered} onChange={(e) => setGstRegistered(e.target.checked)} />
        GST registered (informational only — doesn't affect this estimate)
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "12px" }}>
        <button style={primaryButtonStyle} disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        {saved && <span style={{ fontSize: "12px", color: colors.deepGreen }}>Saved ✓</span>}
        {error && <span style={{ fontSize: "12px", color: "#a13d3d" }}>{error}</span>}
      </div>
    </Card>
  );
}

// =====================================================================
// Economic & Policy Context — light, real, sourced. Explicitly not a
// full news feed; full coverage deferred to Government, Economic &
// Livelihood Intelligence.
// =====================================================================

function EconomicContextCard() {
  const refresh = useAction(api.taxPlanning.refreshTaxEconomicContext);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = useQuery(api.taxPlanning.listTaxEconomicContextItems, {}) as any[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [items, setItems] = useState<any[] | null>(null);
  const [requested, setRequested] = useState(false);

  if (cached !== undefined && !requested) {
    setRequested(true);
    if (cached.length === 2) {
      setItems(cached);
    } else {
      void refresh({}).then((r) => setItems(r));
    }
  }

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "6px" }}>
        <div style={{ fontFamily: fontSerif, fontSize: "16px" }}>Economic &amp; policy context</div>
        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: colors.inkSoft }}>
          Full coverage coming soon
        </span>
      </div>
      <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
        A few real, sourced items related to tax and economic policy right now.
      </div>

      {items === null ? (
        <div style={{ fontSize: "12px", color: colors.inkSoft }}>loading…</div>
      ) : (
        items.map((item, i) => (
          <div key={item._id ?? i} style={{ padding: "8px 0", borderBottom: i < items.length - 1 ? `1px solid ${colors.creamDim}` : "none" }}>
            <div style={{ fontWeight: 700, fontSize: "13px" }}>{item.title}</div>
            <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "2px" }}>
              Source: {item.sourceLabel}, retrieved {dayMonth(item.fetchedAt)} —{" "}
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                View
              </a>
            </div>
          </div>
        ))
      )}

      <p style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "10px", marginBottom: 0 }}>
        Deeper economic and livelihood intelligence — how policy shifts and the broader economy affect your household specifically — is
        coming in <strong>Government, Economic &amp; Livelihood Intelligence</strong>.
      </p>
    </Card>
  );
}

// =====================================================================
// Result screen — shared shell for all 4 routes.
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

      {bundle.route === "deductionSummary" && <DeductionSummaryResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
      {bundle.route === "regimeComparison" && <RegimeComparisonResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
      {bundle.route === "deductionGaps" && <DeductionGapsResult bundle={bundle} onAskAgain={onAskAgain} householdId={householdId} />}
      {bundle.route === "taxSavingInvestments" && <TaxSavingInvestmentsResult bundle={bundle} onAskAgain={onAskAgain} />}
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
    <div style={{ background: "#F5EBD8", border: `1px dashed ${AMBER}`, borderRadius: radius, padding: "12px 14px", fontSize: "12.5px", color: colors.ink }}>
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
  const ask = useAction(api.taxPlanning.askTaxQuestion);
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
            void requestConsult({ sourceService: "tax", sourceEntityId, topic: question })
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
// Deduction summary result
// =====================================================================

function DeductionSummaryResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
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
      <VerdictBanner tone="green" badge={`${format(r.totalDeductionsMinorUnits)} in deductions found`} headline={r.narration.headline} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
        <StatCard label="Home loan interest" value={format(r.loanInterestDeductionMinorUnits)} />
        <StatCard label="Insurance premiums" value={format(r.insurancePremiumDeductionMinorUnits)} />
        <StatCard label="Investments (80C)" value={format(r.investmentDeductionMinorUnits)} />
        <StatCard label="Standard deduction" value={format(r.standardDeductionMinorUnits)} />
      </div>

      <CollapsibleSection title="How this was calculated" defaultOpen>
        <LineItem label="Home loan interest (Sec 24(b), capped)" value={format(r.loanInterestDeductionMinorUnits)} />
        <LineItem label="Insurance premiums (Sec 80D, capped)" value={format(r.insurancePremiumDeductionMinorUnits)} />
        <LineItem label="80C investments (capped)" value={format(r.investmentDeductionMinorUnits)} />
        <LineItem label="Standard deduction" value={format(r.standardDeductionMinorUnits)} />
        <LineItem label="Total deductions" value={format(r.totalDeductionsMinorUnits)} bold />
        <p style={{ fontSize: "12px", color: colors.inkSoft, marginTop: "10px", fontStyle: "italic" }}>
          Each figure is capped at its real, sourced legal limit — not just added up raw.
        </p>
      </CollapsibleSection>

      <CaveatBox>This is an estimate based on what is tracked in FinComp, not a verified filing. Confirm actual figures with your documents before filing.</CaveatBox>

      {r.narration.caveats.length > 0 && (
        <ul style={{ fontSize: "12px", color: colors.inkSoft, margin: 0, paddingLeft: "18px" }}>
          {(r.narration.caveats as string[]).map((c: string, i: number) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      <ActionRow narration={r.narration} deterministic={r} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={r.summaryId ?? householdId} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Deduction limits sourced from the Income Tax Department, retrieved {dayMonth(bundle.askedAt)}.{" "}
        <a href={r.sourceUrl} target="_blank" rel="noreferrer">
          View source
        </a>
        {r._fromCache && " (shown from a saved calculation)"}
      </p>
    </>
  );
}

// =====================================================================
// Regime comparison result — side-by-side layout.
// =====================================================================

const REGIME_LABEL: Record<string, string> = { old: "Old Regime", new: "New Regime", similar: "Similar" };

function RegimeComparisonResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
  const { format } = useCurrency();
  const r = bundle.result;
  if (!r || r.state !== "COMPUTED") {
    return (
      <Card>
        <p style={{ fontSize: "13px", color: "#a15c1e", margin: 0 }}>{r?.reason ?? "This comparison isn't available right now."}</p>
      </Card>
    );
  }
  const recommended = r.recommendedRegime as "old" | "new" | "similar";
  const badge = recommended === "similar" ? "Both regimes are similar" : `${REGIME_LABEL[recommended]} saves ${format(Math.abs(r.oldRegimeEstimatedTaxMinorUnits - r.newRegimeEstimatedTaxMinorUnits))}`;

  const regimeCardStyle = (thisRegime: "old" | "new"): React.CSSProperties => ({
    flex: 1,
    background: "#ffffff",
    border: `2px solid ${recommended === thisRegime ? colors.deepGreen : colors.sageGreen}`,
    borderRadius: radius,
    padding: "16px 20px",
    position: "relative",
  });

  return (
    <>
      <VerdictBanner tone="green" badge={badge.toUpperCase()} headline={r.narration.headline} />

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <div style={regimeCardStyle("old")}>
          {recommended === "old" && (
            <span style={{ position: "absolute", top: "-10px", left: "16px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", background: colors.deepGreen, color: colors.cream, borderRadius: "8px", padding: "2px 8px" }}>
              Recommended
            </span>
          )}
          <div style={caps}>Old Regime</div>
          <div style={{ fontFamily: fontSerif, fontSize: "22px", color: colors.deepGreen }}>{format(r.oldRegimeEstimatedTaxMinorUnits)}</div>
          {r.oldTaxableIncomeMinorUnits !== undefined && (
            <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "4px" }}>
              Taxable income {format(r.oldTaxableIncomeMinorUnits)}
              {r.oldRegimeTopSlabLabel && ` · ${r.oldRegimeTopSlabLabel}`}
            </div>
          )}
        </div>
        <div style={regimeCardStyle("new")}>
          {recommended === "new" && (
            <span style={{ position: "absolute", top: "-10px", left: "16px", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", background: colors.deepGreen, color: colors.cream, borderRadius: "8px", padding: "2px 8px" }}>
              Recommended
            </span>
          )}
          <div style={caps}>New Regime</div>
          <div style={{ fontFamily: fontSerif, fontSize: "22px", color: colors.deepGreen }}>{format(r.newRegimeEstimatedTaxMinorUnits)}</div>
          {r.newTaxableIncomeMinorUnits !== undefined && (
            <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "4px" }}>
              Taxable income {format(r.newTaxableIncomeMinorUnits)}
              {r.newRegimeTopSlabLabel && ` · ${r.newRegimeTopSlabLabel}`}
            </div>
          )}
        </div>
      </div>
      {recommended === "similar" && (
        <p style={{ fontSize: "12px", color: colors.inkSoft, margin: 0 }}>Both regimes come out within a small margin of each other for your numbers.</p>
      )}

      <CaveatBox>This is an estimate to confirm with an actual filing process or a tax professional — it does not tell you which regime to choose.</CaveatBox>

      {r.narration.caveats.length > 0 && (
        <ul style={{ fontSize: "12px", color: colors.inkSoft, margin: 0, paddingLeft: "18px" }}>
          {(r.narration.caveats as string[]).map((c: string, i: number) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}

      <ActionRow narration={r.narration} deterministic={r} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={r.comparisonId ?? householdId} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Calculated {dayMonth(bundle.askedAt)}.{r._fromCache && " (shown from a saved calculation)"}
      </p>
    </>
  );
}

// =====================================================================
// Deduction gaps result
// =====================================================================

function DeductionGapsResult({ bundle, onAskAgain, householdId }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void; householdId: string }) {
  const { format } = useCurrency();
  const r = bundle.result;
  if (!r || r.state !== "COMPUTED") {
    return (
      <Card>
        <p style={{ fontSize: "13px", color: "#a15c1e", margin: 0 }}>{r?.reason ?? "This check isn't available right now."}</p>
      </Card>
    );
  }
  const gaps = r.gaps as { gapType: string; description: string; estimatedMissedDeductionMinorUnits?: number }[];
  const isAmber = gaps.length > 0;

  return (
    <>
      <VerdictBanner tone={isAmber ? "amber" : "green"} badge={gaps.length === 0 ? "No gaps found" : `${gaps.length} potential gap${gaps.length === 1 ? "" : "s"} found`} headline={r.narration.headline} />

      <CollapsibleSection title="Details" defaultOpen>
        {gaps.length === 0 ? (
          <p style={{ fontSize: "13px", margin: 0 }}>{r.narration.plainLanguage}</p>
        ) : (
          gaps.map((g, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: i < gaps.length - 1 ? `1px solid ${colors.creamDim}` : "none" }}>
              <div style={{ fontSize: "13px" }}>{g.description}</div>
              {g.estimatedMissedDeductionMinorUnits !== undefined && (
                <div style={{ fontSize: "12px", color: colors.deepGreen, marginTop: "2px", fontWeight: 600 }}>
                  Room remaining: {format(g.estimatedMissedDeductionMinorUnits)}
                </div>
              )}
            </div>
          ))
        )}
      </CollapsibleSection>

      {r.narration.caveats.length > 0 && (
        <CaveatBox>
          <ul style={{ margin: 0, paddingLeft: "16px" }}>
            {(r.narration.caveats as string[]).map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </CaveatBox>
      )}

      <ActionRow narration={r.narration} deterministic={r} onAskAgain={onAskAgain} question={bundle.question} route={bundle.route} sourceEntityId={r.gapsId ?? householdId} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>
        Based on your current household data, calculated {dayMonth(bundle.askedAt)}.{r._fromCache && " (shown from a saved calculation)"}
      </p>
    </>
  );
}

// =====================================================================
// Tax-saving investments — reuses Investment's own category education,
// framed for 80C relevance. No separate ActionRow: this route has no
// narration object of its own (real category description shown as-is).
// =====================================================================

function TaxSavingInvestmentsResult({ bundle }: { bundle: ResultBundle; onAskAgain: (bundle: ResultBundle) => void }) {
  const r = bundle.result;
  if (!r) {
    return (
      <Card>
        <p style={{ fontSize: "13px", margin: 0 }}>This information isn't available right now.</p>
      </Card>
    );
  }
  return (
    <>
      <VerdictBanner tone="green" badge="Tax-saving investment category" headline="A general, non-product category relevant to Section 80C" />
      <Card>
        <div style={{ fontWeight: 700, fontSize: "14px", color: colors.deepGreen, marginBottom: "4px" }}>PPF</div>
        <div style={{ fontSize: "13px" }}>{r.description}</div>
        <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "8px" }}>
          Source: {r.usedGenericFallback ? "general investor education" : r.sourceLabel ?? "general investor education"}
          {r.fetchedAt && `, retrieved ${dayMonth(r.fetchedAt)}`}
        </div>
      </Card>
      <CaveatBox>This describes a general category, not a specific product — it isn't a recommendation of what to invest in.</CaveatBox>
    </>
  );
}

// =====================================================================
// "Email me a summary" — same pattern as every other service.
// =====================================================================

function EmailSummaryButton({
  narration,
  deterministic,
}: {
  narration: { headline: string; plainLanguage: string; caveats: string[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deterministic: any;
}) {
  const send = useAction(api.taxPlanning.emailTaxSummary);
  const [busy, setBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const status = useQuery(api.taxPlanning.emailSendStatus, outboundId ? { outboundId } : "skip");

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
