import { FormEvent, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { ghostButtonStyle, inputStyle, linkStyle, primaryButtonStyle, useDraft } from "../goalPlanning/kit";

const rupee = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? "—" : `₹${Math.round(minor).toLocaleString("en-IN")}`;
const monthYear = (ts: number | null | undefined) =>
  ts === null || ts === undefined
    ? "—"
    : new Date(ts).toLocaleDateString("en-IN", { year: "numeric", month: "short" });
const dayMonth = (ts: number) =>
  new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const caps: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: colors.inkSoft,
  margin: "0 0 8px",
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#ffffff",
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        padding: "18px 20px",
      }}
    >
      {children}
    </section>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#a15c1e" }}>
      {items.map((w, i) => (
        <li key={i}>{w}</li>
      ))}
    </ul>
  );
}

type Tab = "overview" | "affordability" | "prepayment";

export function LoanDebtScreen() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "820px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>
            Loan &amp; Debt Resilience
          </h1>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>
            Your debts, whether a new loan fits, and what a prepayment would do. Every number is
            calculated here; the wording is written from those numbers.
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", borderBottom: `1px solid ${colors.sageGreen}` }}>
          {(
            [
              ["overview", "Debt Overview"],
              ["affordability", "Can We Take This Loan?"],
              ["prepayment", "Prepayment Simulator"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                fontFamily: fontSans,
                fontSize: "13px",
                fontWeight: tab === key ? 700 : 500,
                color: tab === key ? colors.deepGreen : colors.inkSoft,
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === key ? colors.deepGreen : "transparent"}`,
                padding: "8px 12px",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "overview" && <DebtOverviewPanel />}
        {tab === "affordability" && <AffordabilityPanel />}
        {tab === "prepayment" && <PrepaymentPanel />}
      </div>
    </main>
  );
}

// =====================================================================
// Debt Overview
// =====================================================================

function DebtOverviewPanel() {
  const now = useMemo(() => Date.now(), []);
  const overview = useQuery(api.loanDebt.getDebtOverview, { now });

  if (overview === undefined) return <p style={{ color: colors.inkSoft }}>loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
          <Stat label="Total outstanding" value={rupee(overview.totalOutstandingMinorUnits)} />
          <Stat label="Combined monthly payments" value={rupee(overview.combinedMonthlyPaymentMinorUnits)} />
          <Stat label="Active debts" value={String(overview.activeDebtCount)} />
        </div>
        <Warnings items={overview.warnings} />
      </Card>

      {overview.debts.length === 0 ? (
        <Card>
          <p style={{ fontSize: "13px", color: colors.inkSoft, margin: 0 }}>
            No debts recorded yet. Add loans in Financial Foundation → Obligations, then fill in their
            rate and tenure here.
          </p>
        </Card>
      ) : (
        overview.debts.map((d) => <DebtCard key={d.obligationId} debt={d} />)
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: "18px", fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: "12px", color: colors.inkSoft }}>{label}</div>
    </div>
  );
}

type DebtRow = {
  obligationId: Id<"obligations">;
  label: string;
  balanceMinorUnits: number;
  monthlyPaymentMinorUnits: number;
  annualRatePercent: number | null;
  rateType: "fixed" | "floating" | null;
  remainingTenureMonths: number | null;
  nextPaymentDate: number;
  nextResetDate: number | null;
  obligationType: string | null;
  warnings: string[];
};

function DebtCard({ debt }: { debt: DebtRow }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "15px" }}>{debt.label}</div>
          <div style={{ fontSize: "12px", color: colors.inkSoft, marginTop: "2px" }}>
            {rupee(debt.balanceMinorUnits)} outstanding · {rupee(debt.monthlyPaymentMinorUnits)}/mo ·{" "}
            {debt.annualRatePercent !== null ? `${debt.annualRatePercent}% p.a.` : "rate unknown"} ·{" "}
            <strong>{debt.rateType ? debt.rateType : "fixed/floating unknown"}</strong> ·{" "}
            {debt.remainingTenureMonths !== null
              ? `${debt.remainingTenureMonths} mo left`
              : "tenure unknown"}
          </div>
          <div style={{ fontSize: "12px", color: colors.inkSoft, marginTop: "2px" }}>
            Next payment {dayMonth(debt.nextPaymentDate)}
            {debt.rateType === "floating" &&
              ` · next rate reset ${debt.nextResetDate ? dayMonth(debt.nextResetDate) : "unknown"}`}
          </div>
        </div>
        <button style={ghostButtonStyle} onClick={() => setEditing(!editing)}>
          {editing ? "Close" : "Edit loan details"}
        </button>
      </div>
      <Warnings items={debt.warnings} />
      {editing && <LoanDetailsForm obligationId={debt.obligationId} onDone={() => setEditing(false)} />}
    </Card>
  );
}

function LoanDetailsForm({ obligationId, onDone }: { obligationId: Id<"obligations">; onDone: () => void }) {
  const update = useMutation(api.loanDebt.updateLoanDetails);
  const [type, setType] = useState<string>("");
  const [ratePct, setRatePct] = useState("");
  const [rateType, setRateType] = useState<string>("");
  const [tenure, setTenure] = useState("");
  const [origPrincipal, setOrigPrincipal] = useState("");
  const [minPayment, setMinPayment] = useState("");
  const [fees, setFees] = useState("");
  const [prepayTerms, setPrepayTerms] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const args: Record<string, unknown> = { obligationId };
    if (type) args.obligationType = type;
    if (ratePct.trim() !== "") args.annualRateBasisPoints = Math.round(Number(ratePct) * 100);
    if (rateType) args.rateType = rateType;
    if (tenure.trim() !== "") args.remainingTenureMonths = Number(tenure);
    if (origPrincipal.trim() !== "") args.originalPrincipalMinorUnits = Number(origPrincipal);
    if (minPayment.trim() !== "") args.minimumPaymentMinorUnits = Number(minPayment);
    if (fees.trim() !== "") args.feesMinorUnits = Number(fees);
    if (prepayTerms.trim() !== "") args.prepaymentTerms = prepayTerms.trim();
    void update(args as never)
      .then(() => onDone())
      .catch((err: Error) => setError(err.message));
  };

  const field: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };
  const cell: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px", color: colors.inkSoft };

  return (
    <form
      onSubmit={submit}
      style={{
        marginTop: "12px",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        gap: "10px",
        alignItems: "end",
      }}
    >
      <label style={cell}>
        Loan type
        <select style={field} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">—</option>
          <option value="homeLoan">Home loan</option>
          <option value="personalLoan">Personal loan</option>
          <option value="vehicleLoan">Vehicle loan</option>
          <option value="educationLoan">Education loan</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label style={cell}>
        Annual rate (%)
        <input style={field} value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="e.g. 9.25" />
      </label>
      <label style={cell}>
        Rate type
        <select style={field} value={rateType} onChange={(e) => setRateType(e.target.value)}>
          <option value="">—</option>
          <option value="fixed">Fixed</option>
          <option value="floating">Floating</option>
        </select>
      </label>
      <label style={cell}>
        Remaining tenure (months)
        <input style={field} value={tenure} onChange={(e) => setTenure(e.target.value)} placeholder="e.g. 84" />
      </label>
      <label style={cell}>
        Original principal (₹)
        <input style={field} value={origPrincipal} onChange={(e) => setOrigPrincipal(e.target.value)} />
      </label>
      <label style={cell}>
        Minimum payment (₹)
        <input style={field} value={minPayment} onChange={(e) => setMinPayment(e.target.value)} />
      </label>
      <label style={cell}>
        Fees (₹)
        <input style={field} value={fees} onChange={(e) => setFees(e.target.value)} />
      </label>
      <label style={{ ...cell, gridColumn: "1 / -1" }}>
        Prepayment terms (free text)
        <input
          style={field}
          value={prepayTerms}
          onChange={(e) => setPrepayTerms(e.target.value)}
          placeholder="e.g. 2% of prepaid amount if within 3 years"
        />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: "8px", alignItems: "center" }}>
        <button style={primaryButtonStyle} type="submit">
          Save
        </button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </div>
    </form>
  );
}

// =====================================================================
// New Loan Affordability
// =====================================================================

const STATE_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  FEASIBLE_WITH_CURRENT_CONSTRAINTS: { label: "Feasible with current constraints", bg: "#1F4A3A", fg: "#F6F1E4" },
  NEEDS_HUMAN_REVIEW: { label: "Needs human review", bg: "#8a6d1f", fg: "#F6F1E4" },
  MONTHLY_DEFICIT: { label: "Monthly deficit", bg: "#8a2f2f", fg: "#F6F1E4" },
  CONSTRAINT_BREACHED: { label: "Constraint breached", bg: "#8a2f2f", fg: "#F6F1E4" },
  INSUFFICIENT_DATA: { label: "Insufficient data", bg: "#55503F", fg: "#F6F1E4" },
};

function AffordabilityPanel() {
  const check = useAction(api.loanDebt.checkAffordability);
  const [principal, setPrincipal] = useState("");
  const [downPayment, setDownPayment] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [rateType, setRateType] = useState<"fixed" | "floating">("fixed");
  const [tenure, setTenure] = useState("");
  const [fees, setFees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);

  const run = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    void check({
      offer: {
        principalMinorUnits: Number(principal),
        downPaymentMinorUnits: downPayment.trim() === "" ? 0 : Number(downPayment),
        annualRateBasisPoints: Math.round(Number(ratePct) * 100),
        rateType,
        tenureMonths: Number(tenure),
        feesMinorUnits: fees.trim() === "" ? 0 : Number(fees),
      },
    })
      .then((r) => setResult(r.result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };
  const cell: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px", color: colors.inkSoft };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <div style={caps}>The loan offer</div>
        <form
          onSubmit={run}
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px", alignItems: "end" }}
        >
          <label style={cell}>
            Loan principal (₹)
            <input style={f} value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="amount borrowed" />
          </label>
          <label style={cell}>
            Down payment (₹)
            <input style={f} value={downPayment} onChange={(e) => setDownPayment(e.target.value)} placeholder="0 if none" />
          </label>
          <label style={cell}>
            Annual rate (%)
            <input style={f} value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="e.g. 9.5 — 0 for interest-free" />
          </label>
          <label style={cell}>
            Rate type
            <select style={f} value={rateType} onChange={(e) => setRateType(e.target.value as "fixed" | "floating")}>
              <option value="fixed">Fixed</option>
              <option value="floating">Floating</option>
            </select>
          </label>
          <label style={cell}>
            Tenure (months)
            <input style={f} value={tenure} onChange={(e) => setTenure(e.target.value)} placeholder="e.g. 120" />
          </label>
          <label style={cell}>
            Fees / charges (₹)
            <input style={f} value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0 if none" />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: "8px", alignItems: "center" }}>
            <button style={primaryButtonStyle} type="submit" disabled={busy}>
              {busy ? "Calculating…" : "Check affordability"}
            </button>
            {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
          </div>
        </form>
      </Card>

      {result && <AffordabilityResult result={result} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AffordabilityResult({ result }: { result: any }) {
  const d = result.deterministic;
  const rc = result.rateContext;
  const n = result.narration;
  const st = STATE_STYLE[result.state] ?? STATE_STYLE.INSUFFICIENT_DATA;

  return (
    <Card>
      <div
        style={{
          background: st.bg,
          color: st.fg,
          borderRadius: radius,
          padding: "12px 14px",
          marginBottom: "12px",
        }}
      >
        <div style={{ ...caps, color: st.fg, opacity: 0.8, margin: "0 0 4px" }}>{st.label}</div>
        <div style={{ fontSize: "15px" }}>{n.headline}</div>
      </div>

      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "10px" }}>
        <Stat label="Calculated EMI" value={rupee(d.emiMinorUnits)} />
        <Stat label="Total interest" value={rupee(d.totalInterestMinorUnits)} />
        <Stat label="Total repayment" value={rupee(d.totalRepaymentMinorUnits)} />
        <Stat label="Upfront cash required" value={rupee(d.upfrontCashRequiredMinorUnits)} />
        <Stat label="Monthly cash remaining" value={rupee(d.monthlyCashRemainingMinorUnits)} />
        <Stat label="Reserve remaining" value={rupee(d.reserveRemainingMinorUnits)} />
        <Stat label="Closes on" value={monthYear(d.closureDate)} />
        <Stat label="Rate type" value={d.rateType} />
      </div>

      {d.conflicts.length > 0 && (
        <div style={{ fontSize: "12px", color: "#a15c1e", marginBottom: "8px" }}>
          {d.conflicts.map((c: string, i: number) => (
            <div key={i}>• {c}</div>
          ))}
        </div>
      )}

      <p style={{ fontSize: "13px", margin: "8px 0" }}>{n.plainLanguage}</p>

      {n.tradeoffs.length > 0 && (
        <>
          <div style={caps}>Trade-offs</div>
          <ul style={{ fontSize: "13px", margin: "0 0 10px", paddingLeft: "18px" }}>
            {n.tradeoffs.map((t: string, i: number) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {n.lenderQuestions.length > 0 && (
        <>
          <div style={caps}>Ask the lender</div>
          <ul style={{ fontSize: "13px", margin: "0 0 10px", paddingLeft: "18px" }}>
            {n.lenderQuestions.map((q: string, i: number) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
      {n.missingInfoNotes.length > 0 && <Warnings items={n.missingInfoNotes} />}

      <div
        style={{
          marginTop: "12px",
          padding: "10px 12px",
          background: colors.creamDim,
          borderRadius: radius,
          fontSize: "12px",
          color: colors.inkSoft,
        }}
      >
        <strong>Reference context (not part of the calculation, not a guarantee):</strong>{" "}
        {rc.available ? (
          <>
            As of {rc.retrievalDate ? dayMonth(rc.retrievalDate) : "the last check"}, the reference
            rate was {rc.referenceRatePercent}% — your quoted rate is {rc.quotedRatePercent}%, a
            difference of {rc.differencePercentagePoints} percentage points.{" "}
          </>
        ) : (
          <>{rc.note} </>
        )}
        Source:{" "}
        <a href={rc.sourceUrl} target="_blank" rel="noreferrer" style={linkStyle}>
          {rc.sourceLabel}
        </a>
        . {rc.available && rc.note}
      </div>

      <EmailSummaryButton narration={n} deterministic={d} />
    </Card>
  );
}

// =====================================================================
// "Email me a summary of this" — a single user-clicked send, never
// automatic. Reuses the result's own narration verbatim; the recipient
// is always the signed-in user's own account email (resolved server
// -side). Shows AgentMail's own delivery status, not an assumed success.
// =====================================================================

type EmailableNarration = {
  headline: string;
  plainLanguage: string;
  tradeoffs: string[];
  lenderQuestions?: string[];
  nextSteps?: string[];
};

function EmailSummaryButton({
  narration,
  deterministic,
}: {
  narration: EmailableNarration;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deterministic: any;
}) {
  const send = useAction(api.loanDebt.emailLoanResultSummary);
  const [busy, setBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [failMessage, setFailMessage] = useState<string | null>(null);
  const status = useQuery(api.loanDebt.emailSendStatus, outboundId ? { outboundId } : "skip");

  const run = () => {
    setBusy(true);
    setFailMessage(null);
    void send({
      narration: {
        headline: narration.headline,
        plainLanguage: narration.plainLanguage,
        tradeoffs: narration.tradeoffs,
        lenderQuestions: narration.lenderQuestions,
        nextSteps: narration.nextSteps,
      },
      deterministic,
    })
      .then((r) => {
        if (r.status === "sent" && r.outboundId) setOutboundId(r.outboundId);
        else setFailMessage(r.detail);
      })
      .catch((err: Error) => setFailMessage(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
      <button style={ghostButtonStyle} onClick={run} disabled={busy}>
        {busy ? "Sending…" : "✉ Email me a summary of this"}
      </button>
      {outboundId && (
        <span style={{ fontSize: "12px", color: colors.inkSoft }}>
          {status === undefined
            ? "Checking delivery…"
            : `Delivery status: ${(status as { status?: string } | null)?.status ?? "unknown"}`}
        </span>
      )}
      {failMessage && <span style={{ fontSize: "12px", color: "#a13d3d" }}>{failMessage}</span>}
    </div>
  );
}

// =====================================================================
// Prepayment Simulator
// =====================================================================

function PrepaymentPanel() {
  const [mode, setMode] = useState<"amount" | "target">("amount");

  const modeBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: fontSans,
    fontSize: "13px",
    fontWeight: 600,
    border: "none",
    padding: "9px 18px",
    cursor: "pointer",
    background: active ? colors.deepGreen : "#ffffff",
    color: active ? colors.cream : colors.inkSoft,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          border: `1px solid ${colors.sageGreen}`,
          borderRadius: radius,
          overflow: "hidden",
        }}
      >
        <button style={modeBtn(mode === "amount")} onClick={() => setMode("amount")}>
          I have an amount to pay
        </button>
        <button style={modeBtn(mode === "target")} onClick={() => setMode("target")}>
          I want a target date
        </button>
      </div>

      {mode === "amount" ? <PrepaymentAmountMode /> : <PrepaymentTargetMode />}
    </div>
  );
}

// The original, verified "pay X, see result" forward mode — unchanged.
function PrepaymentAmountMode() {
  const obligations = useQuery(api.loanDebt.listObligations);
  const simulate = useAction(api.loanDebt.simulatePrepayment);
  const [obligationId, setObligationId] = useState<string>("");
  const [lumpSum, setLumpSum] = useState("");
  const [extraMonthly, setExtraMonthly] = useState("");
  const [mode, setMode] = useState<"reduceTenure" | "reduceEmi">("reduceTenure");
  const [charge, setCharge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);

  const chosen = obligations?.find((o) => o.obligationId === obligationId);

  const run = (e: FormEvent) => {
    e.preventDefault();
    if (!obligationId) return;
    setError(null);
    setResult(null);
    setBusy(true);
    void simulate({
      obligationId: obligationId as Id<"obligations">,
      scenario: {
        lumpSumMinorUnits: lumpSum.trim() === "" ? 0 : Number(lumpSum),
        extraMonthlyMinorUnits: extraMonthly.trim() === "" ? 0 : Number(extraMonthly),
        mode,
        prepaymentChargeMinorUnits: charge.trim() === "" ? 0 : Number(charge),
      },
    })
      .then((r) => setResult(r.result))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };
  const cell: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px", color: colors.inkSoft };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <div style={caps}>Simulate a prepayment on an existing loan</div>
        {obligations === undefined ? (
          <p style={{ color: colors.inkSoft }}>loading…</p>
        ) : obligations.length === 0 ? (
          <p style={{ fontSize: "13px", color: colors.inkSoft, margin: 0 }}>No loans recorded.</p>
        ) : (
          <form
            onSubmit={run}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px", alignItems: "end" }}
          >
            <label style={{ ...cell, gridColumn: "1 / -1" }}>
              Loan
              <select style={f} value={obligationId} onChange={(e) => setObligationId(e.target.value)}>
                <option value="">Choose a loan…</option>
                {obligations.map((o) => (
                  <option key={o.obligationId} value={o.obligationId}>
                    {o.label} — {rupee(o.balanceMinorUnits)} @ {o.hasRate ? `${o.annualRateBasisPoints! / 100}%` : "rate missing"}
                  </option>
                ))}
              </select>
            </label>
            {chosen && !chosen.hasRate && (
              <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#a15c1e" }}>
                This loan has no interest rate recorded — add it under Debt Overview before simulating.
              </div>
            )}
            <label style={cell}>
              Lump-sum prepayment (₹)
              <input style={f} value={lumpSum} onChange={(e) => setLumpSum(e.target.value)} placeholder="0 if none" />
            </label>
            <label style={cell}>
              Extra each month (₹)
              <input style={f} value={extraMonthly} onChange={(e) => setExtraMonthly(e.target.value)} placeholder="0 if none" />
            </label>
            <label style={cell}>
              Apply the extra to
              <select style={f} value={mode} onChange={(e) => setMode(e.target.value as "reduceTenure" | "reduceEmi")}>
                <option value="reduceTenure">Reduce tenure (keep EMI)</option>
                <option value="reduceEmi">Reduce EMI (keep tenure)</option>
              </select>
            </label>
            <label style={cell}>
              Confirmed prepayment charge (₹)
              <input style={f} value={charge} onChange={(e) => setCharge(e.target.value)} placeholder="0 if none" />
            </label>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: "8px", alignItems: "center" }}>
              <button style={primaryButtonStyle} type="submit" disabled={busy || !obligationId}>
                {busy ? "Calculating…" : "Simulate"}
              </button>
              {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
            </div>
          </form>
        )}
      </Card>

      {result && <PrepaymentResult result={result} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PrepaymentResult({ result }: { result: any }) {
  if (result.state === "INSUFFICIENT_DATA") {
    return (
      <Card>
        <div style={caps}>Insufficient data</div>
        <p style={{ fontSize: "13px", margin: 0 }}>{result.reason}</p>
      </Card>
    );
  }
  const d = result.deterministic;
  const n = result.narration;
  return (
    <Card>
      <div style={{ fontFamily: fontSerif, fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
        {n.headline}
      </div>
      <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "12px" }}>
        {d.loanLabel} · {d.annualRatePercent}% p.a. · <strong>{d.rateType ?? "fixed/floating unknown"}</strong>
        {d.lumpSumClosesLoan && " · lump sum closes this loan immediately"}
      </div>

      <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", marginBottom: "10px" }}>
        <Stat label="Debt-free (baseline)" value={monthYear(d.baseline.debtFreeDate)} />
        <Stat label="Debt-free (revised)" value={monthYear(d.revised.debtFreeDate)} />
        <Stat label="Interest saved (gross)" value={rupee(d.interestSavedGrossMinorUnits)} />
        <Stat label="Prepayment charge" value={rupee(d.prepaymentChargeMinorUnits)} />
        <Stat label="Net saving" value={rupee(d.netSavingMinorUnits)} />
        <Stat label="Reserve after lump sum" value={rupee(d.reserveAfterLumpSumMinorUnits)} />
        {d.revised.mode === "reduceEmi" && <Stat label="New EMI" value={rupee(d.revised.newEmiMinorUnits)} />}
      </div>

      {d.reserveBelowOneMonthEssentials && (
        <div style={{ fontSize: "12px", color: "#a15c1e", marginBottom: "8px" }}>
          • After this lump sum, your eligible liquid reserve drops below one month of essential expenses
          {d.affectedGoalsFlag && " — and you have active goals in confirmed timelines that rely on that reserve"}.
        </div>
      )}

      <p style={{ fontSize: "13px", margin: "8px 0" }}>{n.plainLanguage}</p>

      {n.tradeoffs.length > 0 && (
        <>
          <div style={caps}>Trade-offs</div>
          <ul style={{ fontSize: "13px", margin: "0 0 10px", paddingLeft: "18px" }}>
            {n.tradeoffs.map((t: string, i: number) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {n.lenderQuestions.length > 0 && (
        <>
          <div style={caps}>Confirm with the lender</div>
          <ul style={{ fontSize: "13px", margin: 0, paddingLeft: "18px" }}>
            {n.lenderQuestions.map((q: string, i: number) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// =====================================================================
// Prepayment Simulator — target mode ("I want a target date")
// Wraps the already-verified simulatePrepaymentTarget action. No new
// calculation here: every number and every conflict/shortfall flag comes
// straight off result.deterministic; the headline is result.narration.
// =====================================================================

const FC_RED = "#A23B2E";
const FC_RED_BG = "#F5E2DE";
const FC_AMBER = "#8A6D3B";
const FC_AMBER_BG = "#F5EBD8";

function PrepaymentTargetMode() {
  const obligations = useQuery(api.loanDebt.listObligations);
  const simulate = useAction(api.loanDebt.simulatePrepaymentTarget);

  // Draft auto-save — same debounced localStorage pattern the Goal &
  // Situation Planning forms use (kit.useDraft).
  const obligationDraft = useDraft("loanDebt:target:obligationId");
  const kindDraft = useDraft("loanDebt:target:kind");
  const monthsDraft = useDraft("loanDebt:target:months");
  const dateDraft = useDraft("loanDebt:target:date");

  const targetKind: "months" | "date" = kindDraft.value === "date" ? "date" : "months";
  const obligationId = obligationDraft.value;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [cached, setCached] = useState(false);

  const chosen = obligations?.find((o) => o.obligationId === obligationId);

  const targetValid =
    targetKind === "months"
      ? monthsDraft.value.trim() !== "" && Number.isFinite(Number(monthsDraft.value))
      : dateDraft.value.trim() !== "";

  const run = (e: FormEvent) => {
    e.preventDefault();
    if (!obligationId || !targetValid) return;
    setError(null);
    setResult(null);
    setBusy(true);
    const target =
      targetKind === "months"
        ? { kind: "months" as const, months: Number(monthsDraft.value) }
        : // parse as UTC midnight so the date the user picked is the date the
          // backend echoes back (it formats via toISOString)
          { kind: "date" as const, targetDate: new Date(dateDraft.value + "T00:00:00Z").getTime() };
    void simulate({ obligationId: obligationId as Id<"obligations">, target })
      .then((r) => {
        setResult(r.result);
        setCached(r.cached);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };
  const cell: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    fontSize: "12px",
    color: colors.inkSoft,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <div style={caps}>Work backwards from a debt-free date</div>
        {obligations === undefined ? (
          <p style={{ color: colors.inkSoft }}>loading…</p>
        ) : obligations.length === 0 ? (
          <p style={{ fontSize: "13px", color: colors.inkSoft, margin: 0 }}>No loans recorded.</p>
        ) : (
          <form
            onSubmit={run}
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px", alignItems: "end" }}
          >
            <label style={{ ...cell, gridColumn: "1 / -1" }}>
              Which loan?
              <select style={f} value={obligationId} onChange={(e) => obligationDraft.setValue(e.target.value)}>
                <option value="">Choose a loan…</option>
                {obligations.map((o) => (
                  <option key={o.obligationId} value={o.obligationId}>
                    {o.label} — {rupee(o.balanceMinorUnits)} @{" "}
                    {o.hasRate ? `${o.annualRateBasisPoints! / 100}%` : "rate missing"}
                  </option>
                ))}
              </select>
            </label>
            {chosen && !chosen.hasRate && (
              <div style={{ gridColumn: "1 / -1", fontSize: "12px", color: "#a15c1e" }}>
                This loan has no interest rate recorded — add it under Debt Overview before calculating.
              </div>
            )}
            <label style={cell}>
              I want to be debt-free…
              <select style={f} value={targetKind} onChange={(e) => kindDraft.setValue(e.target.value)}>
                <option value="months">In a number of months</option>
                <option value="date">By a specific date</option>
              </select>
            </label>
            {targetKind === "months" ? (
              <label style={cell}>
                Months from now
                <input
                  style={f}
                  value={monthsDraft.value}
                  onChange={(e) => monthsDraft.setValue(e.target.value)}
                  placeholder="e.g. 12"
                  inputMode="numeric"
                />
              </label>
            ) : (
              <label style={cell}>
                Target date
                <input
                  style={f}
                  type="date"
                  value={dateDraft.value}
                  onChange={(e) => dateDraft.setValue(e.target.value)}
                />
              </label>
            )}
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: "8px", alignItems: "center" }}>
              <button style={primaryButtonStyle} type="submit" disabled={busy || !obligationId || !targetValid}>
                {busy ? "Calculating…" : "Calculate what it takes"}
              </button>
              {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
            </div>
          </form>
        )}
      </Card>

      {result && <PrepaymentTargetResult result={result} cached={cached} />}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PrepaymentTargetResult({ result, cached }: { result: any; cached: boolean }) {
  if (result.state === "REJECTED") {
    return (
      <Card>
        <div
          style={{
            background: FC_RED_BG,
            border: `1px solid ${FC_RED}`,
            borderRadius: radius,
            padding: "14px 16px",
          }}
        >
          <div style={{ ...caps, color: FC_RED, margin: "0 0 6px" }}>Target not reachable</div>
          <p style={{ fontSize: "13.5px", margin: "0 0 6px", color: colors.ink }}>{result.error}</p>
          {result.earliestAchievableDate != null && (
            <p style={{ fontSize: "13px", margin: 0, color: colors.inkSoft }}>
              Earliest you could be debt-free on this loan:{" "}
              <strong style={{ color: colors.ink }}>{dayMonth(result.earliestAchievableDate)}</strong>
            </p>
          )}
        </div>
      </Card>
    );
  }

  if (result.state === "INSUFFICIENT_DATA") {
    return (
      <Card>
        <div style={caps}>Insufficient data</div>
        <p style={{ fontSize: "13px", margin: 0 }}>{result.reason}</p>
      </Card>
    );
  }

  const d = result.deterministic;
  const n = result.narration;
  const sf = d.shortfall;
  const cf = d.conflict;
  const showConflict = cf.goalConflict || cf.reserveConflict;

  return (
    <Card>
      <div style={{ fontFamily: fontSerif, fontSize: "17px", lineHeight: 1.5, marginBottom: "4px" }}>
        {n.headline}
      </div>
      <div style={{ fontSize: "11px", color: colors.inkSoft, marginBottom: "12px" }}>
        {cached ? "Shown instantly from a saved calculation." : "Freshly calculated."} · {d.loanLabel} ·{" "}
        {d.annualRatePercent}% p.a. · <strong>{d.rateType ?? "fixed/floating unknown"}</strong> · target{" "}
        {d.targetMonths} month{d.targetMonths === 1 ? "" : "s"} (by {monthYear(d.targetPayoffDate)})
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "16px",
          padding: "14px 0",
          borderTop: `1px solid ${colors.creamDim}`,
          borderBottom: `1px solid ${colors.creamDim}`,
          marginBottom: "12px",
        }}
      >
        <div style={{ fontSize: "12px", color: colors.inkSoft }}>
          <strong style={{ display: "block", fontSize: "17px", color: colors.ink, fontFamily: fontSerif }}>
            {rupee(d.requiredTotalMonthlyMinorUnits)}
          </strong>
          Total monthly payment needed
        </div>
        <div style={{ fontSize: "12px", color: colors.inkSoft }}>
          <strong style={{ display: "block", fontSize: "17px", color: colors.ink, fontFamily: fontSerif }}>
            {rupee(d.requiredExtraMonthlyMinorUnits)}
          </strong>
          Extra beyond current EMI ({rupee(d.currentEmiMinorUnits)})
        </div>
      </div>

      {!d.roundTrip.consistentWithTarget && (
        <div style={{ fontSize: "12px", color: "#a15c1e", marginBottom: "10px" }}>
          • Rounding note: paid at this amount, the loan clears in {d.roundTrip.months ?? "—"} months rather
          than exactly {d.targetMonths}.
        </div>
      )}

      {sf.hasShortfall && (
        <div
          style={{
            padding: "16px",
            background: FC_RED_BG,
            border: `1px solid ${FC_RED}`,
            borderRadius: radius,
            marginBottom: "14px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 700, color: FC_RED, marginBottom: "6px" }}>
            ⚠ This exceeds your current monthly surplus
          </div>
          <div style={{ fontSize: "13.5px", color: colors.ink, marginBottom: "12px" }}>
            You&apos;re short by <strong style={{ color: FC_RED }}>{rupee(sf.gapMinorUnits)}</strong>/month to
            hit this target from current surplus.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {sf.suggestedServices.map((s: { key: string; label: string; reason: string }) => (
              <a
                key={s.key}
                href="#"
                onClick={(e) => e.preventDefault()}
                style={{
                  fontSize: "13px",
                  color: colors.deepGreen,
                  textDecoration: "none",
                  background: "#ffffff",
                  border: `1px solid ${colors.sageGreen}`,
                  borderRadius: radius,
                  padding: "8px 12px",
                }}
              >
                → {s.label} — {s.reason}
              </a>
            ))}
          </div>
        </div>
      )}

      {showConflict && (
        <div
          style={{
            padding: "16px",
            background: FC_AMBER_BG,
            border: `1px solid ${FC_AMBER}`,
            borderRadius: radius,
            marginBottom: "14px",
          }}
        >
          <div style={{ fontSize: "13px", fontWeight: 700, color: FC_AMBER, marginBottom: "6px" }}>
            ⚠{" "}
            {sf.hasShortfall
              ? "It would also strain your reserves and goals"
              : "This fits your surplus, but strains your reserves"}
          </div>
          <div style={{ fontSize: "13.5px", color: colors.ink, lineHeight: 1.5 }}>{cf.conflictDetail}</div>
        </div>
      )}

      {n.plainLanguage && <p style={{ fontSize: "13px", margin: "8px 0" }}>{n.plainLanguage}</p>}

      {n.tradeoffs.length > 0 && (
        <>
          <div style={caps}>Trade-offs</div>
          <ul style={{ fontSize: "13px", margin: "0 0 10px", paddingLeft: "18px" }}>
            {n.tradeoffs.map((t: string, i: number) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {n.nextSteps.length > 0 && (
        <>
          <div style={caps}>Next steps</div>
          <ul style={{ fontSize: "13px", margin: 0, paddingLeft: "18px" }}>
            {n.nextSteps.map((s: string, i: number) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
