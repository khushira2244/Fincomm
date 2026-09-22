import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc, Id } from "../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../theme";
import { EmptyState } from "./EmptyState";
import { useCurrency } from "../lib/currency";

// All data access below (useQuery/useMutation calls, the `now`-ticking
// runway argument, the integer-minor-units payloads) is unchanged from
// the previous build — only rendering/styling is new.

// A plain rupee amount field naturally invites commas ("80,000") — a
// bare Number() on that is NaN, which the backend's integer check
// correctly rejects. Strips non-digit/decimal/minus characters first,
// same fix already applied to Goal & Situation Planning's Career &
// Income section for the identical bug.
function parseAmount(raw: string): number {
  return Number(raw.replace(/[^0-9.-]/g, ""));
}

export function FinancialFoundationScreen() {
  const incomeSources = useQuery(api.incomeSources.listIncomeSources);
  const expenses = useQuery(api.expenses.listExpenses);
  const obligations = useQuery(api.obligations.listObligations);
  const assets = useQuery(api.assets.listAssets);
  const insurancePolicies = useQuery(api.insurance.listInsurancePolicies);
  const [revealed, setRevealed] = useState(false);

  const stillLoading =
    incomeSources === undefined ||
    expenses === undefined ||
    obligations === undefined ||
    assets === undefined ||
    insurancePolicies === undefined;

  const hasAnyData =
    !stillLoading &&
    (incomeSources.length > 0 ||
      expenses.length > 0 ||
      obligations.length > 0 ||
      assets.length > 0 ||
      insurancePolicies.length > 0);

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: fontSerif, fontSize: "28px", margin: "0 0 4px", textAlign: "center" }}>
          Financial Foundation
        </h1>
        <p style={{ color: colors.inkSoft, margin: "0 0 32px", fontSize: "14px", textAlign: "center" }}>
          Add your numbers below — your runway updates as you go.
        </p>

        {!stillLoading && !hasAnyData && !revealed ? (
          <EmptyState
            heading="Start your financial foundation"
            subtext="Add your income, expenses, loans, and savings — this becomes the foundation everything else is calculated from."
            buttonLabel="Add financial details"
            onAction={() => setRevealed(true)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <RunwayCard />
            <IncomeSection incomeSources={incomeSources ?? []} />
            <ExpenseSection expenses={expenses ?? []} />
            <ObligationSection obligations={obligations ?? []} />
            <AssetSection assets={assets ?? []} />
            <InsuranceSection insurancePolicies={insurancePolicies ?? []} />
          </div>
        )}
      </div>
    </main>
  );
}

function RunwayCard() {
  // The query never reads the wall clock itself (queries aren't rerun
  // just because time advances) — instead the client passes `now` in and
  // refreshes it periodically, per the Convex query guidelines.
  // Refreshing matters here specifically: a newly-added income/expense
  // row is written with activeFrom = insert time, later than a `now`
  // frozen at page load, so it would be wrongly filtered out as "not yet
  // active" until `now` catches up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);
  const liveRunway = useQuery(api.runway.calculateRunway, { now });

  // Changing `now` every 5s makes Convex treat it as a new query, which
  // briefly returns undefined while it loads — without this, that flashed
  // "calculating..." and hid the stat row every 5 seconds, which read as
  // the whole card blinking/collapsing. Keep showing the last real result
  // during that gap; only show "calculating..." on the very first load.
  const [runway, setRunway] = useState(liveRunway);
  useEffect(() => {
    if (liveRunway !== undefined) {
      setRunway(liveRunway);
    }
  }, [liveRunway]);

  return (
    <Card>
      <div style={{ fontSize: "13px", color: colors.inkSoft, marginBottom: "6px" }}>
        Household runway
      </div>
      <div style={{ fontFamily: fontSerif, fontSize: "32px", fontWeight: 700, color: colors.deepGreen, marginBottom: "20px" }}>
        {runway === undefined ? "calculating..." : runway.status === "not_depleting" ? "holding steady — income covers what goes out" : `${runway.runwayMonths.toFixed(1)} months`}
      </div>
      {runway !== undefined && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "32px" }}>
          <Stat label="Liquid savings" value={runway.unrestrictedLiquidSavingsMinorUnits} />
          <Stat label="Essential expenses" value={runway.essentialMonthlyExpensesMinorUnits} />
          <Stat label="Total EMI" value={runway.totalEmiMinorUnits} />
          <Stat label="Dependable income" value={runway.dependableMonthlyIncomeMinorUnits} />
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const { format } = useCurrency();
  return (
    <div>
      <div style={{ fontSize: "18px", fontWeight: 700 }}>{format(value)}</div>
      <div style={{ fontSize: "12px", color: colors.inkSoft }}>{label}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#ffffff",
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        padding: "20px 24px",
      }}
    >
      {children}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: fontSerif, fontSize: "18px", margin: "0 0 12px", color: colors.ink }}>
      {children}
    </h2>
  );
}

function EntryRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: `1px solid ${colors.creamDim}`,
        fontSize: "14px",
      }}
    >
      <span>{label}</span>
      <span style={{ color: colors.inkSoft }}>{detail}</span>
    </div>
  );
}

// The shape every extraction (email or upload) produces. Kept in sync
// with convex/documentIntelligence.ts's ExtractedFact type by convention
// (extractedFacts.claimedValue is v.any() at the schema level, since a
// candidate value's shape is deliberately not schema-enforced).
type ClaimedValue = {
  category: "incomeSources" | "expenses" | "obligations" | "assets" | "insurancePolicies";
  label: string;
  amountMinorUnits: number;
  secondaryAmountMinorUnits: number | null;
  detail: string;
};

type PendingFact = Doc<"extractedFacts"> & { sourceType: string };

// Dashed-border pending-confirmation card: a candidate from Document
// Intelligence, never written to a real table until the user acts on it.
function PendingFactCard({
  fact,
  onEdit,
  onConfirm,
}: {
  fact: PendingFact;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const claimed = fact.claimedValue as ClaimedValue;
  const { format } = useCurrency();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "10px",
        marginTop: "10px",
        padding: "10px 12px",
        border: `1px dashed ${colors.midGreen}`,
        borderRadius: radius,
        background: colors.creamDim,
        fontSize: "13px",
      }}
    >
      <span>
        📎 Found in your {fact.sourceType}: <strong>{claimed.label}</strong> — {format(claimed.amountMinorUnits)}
        {claimed.detail ? ` · ${claimed.detail}` : ""}
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onEdit} style={ghostButtonStyle}>
          Edit
        </button>
        <button onClick={onConfirm} style={addButtonStyle}>
          Confirm
        </button>
      </div>
    </div>
  );
}

// Uploads the file to Convex storage, then schedules extraction. Visual
// state only (uploading/error) — no extraction result is shown here; it
// shows up as a pending card once the action finishes.
function UploadLink({ label, sectionHint }: { label: string; sectionHint: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(api.documentIntelligence.generateUploadUrl);
  const uploadDocument = useMutation(api.documentIntelligence.uploadDocument);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStatus("uploading");
    try {
      const uploadUrl = await generateUploadUrl();
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const { storageId } = (await result.json()) as { storageId: Id<"_storage"> };
      await uploadDocument({ storageId, sectionHint });
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div style={{ marginTop: "10px" }}>
      <span
        onClick={() => inputRef.current?.click()}
        style={{ fontSize: "13px", color: colors.deepGreen, textDecoration: "underline", cursor: "pointer" }}
      >
        📎 {label}
      </span>
      {status === "uploading" && (
        <span style={{ marginLeft: "8px", fontSize: "12px", color: colors.inkSoft }}>Uploading and reading…</span>
      )}
      {status === "error" && (
        <span style={{ marginLeft: "8px", fontSize: "12px", color: "#a13d3d" }}>Upload failed. Try again.</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={(e) => void handleFileChange(e)}
      />
    </div>
  );
}

const formRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "center",
  marginTop: "12px",
};

const formInputStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontSize: "14px",
  background: "#ffffff",
  color: colors.ink,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "8px 10px",
};

const addButtonStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "14px",
  background: colors.deepGreen,
  color: colors.cream,
  border: "none",
  borderRadius: radius,
  padding: "8px 16px",
  cursor: "pointer",
};

const ghostButtonStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "13px",
  background: "#ffffff",
  color: colors.deepGreen,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "6px 12px",
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  color: "#a13d3d",
  borderColor: "#a13d3d",
};

// Two-click confirm (no modal) — a first click swaps the label to
// "Really delete?" and only a second click within a few seconds
// actually calls `onDelete`, so a stray click can't silently remove a
// real financial entry. Used by every Financial Foundation row.
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);
  return (
    <button
      style={dangerButtonStyle}
      onClick={() => {
        if (confirming) {
          onDelete();
          setConfirming(false);
        } else {
          setConfirming(true);
        }
      }}
    >
      {confirming ? "Really delete?" : "Delete"}
    </button>
  );
}

function IncomeSection({
  incomeSources,
}: {
  incomeSources: Doc<"incomeSources">[];
}) {
  const pending = useQuery(api.extractedFacts.listPendingByCategory, { category: "incomeSources" });
  const addIncomeSource = useMutation(api.incomeSources.addIncomeSource);
  const confirmFact = useMutation(api.extractedFacts.confirmExtractedFact);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<"monthly" | "weekly" | "annual" | "irregular">("monthly");
  const [dependable, setDependable] = useState(true);
  const [editingFactId, setEditingFactId] = useState<Id<"extractedFacts"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void addIncomeSource({
      label,
      amountMinorUnits: parseAmount(amount),
      currency: "INR",
      cadence,
      reliability: dependable ? "dependable" : "uncertain",
      activeFrom: Date.now(),
    })
      .then(async (newId) => {
        if (editingFactId) {
          await confirmFact({ factId: editingFactId, targetEntityId: newId });
          setEditingFactId(null);
        }
        setLabel("");
        setAmount("");
        setCadence("monthly");
        setDependable(true);
      })
      .catch((err: Error) => setError(err.message));
  };

  const startEdit = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    setLabel(claimed.label);
    setAmount(String(claimed.amountMinorUnits));
    setCadence("monthly");
    setDependable(true);
    setEditingFactId(fact._id);
  };

  const confirmDirectly = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    void addIncomeSource({
      label: claimed.label,
      amountMinorUnits: claimed.amountMinorUnits,
      currency: "INR",
      cadence: "monthly",
      reliability: "dependable",
      activeFrom: Date.now(),
    }).then((newId) => confirmFact({ factId: fact._id, targetEntityId: newId }));
  };

  return (
    <Card>
      <SectionHeading>Income sources</SectionHeading>
      {[...incomeSources].reverse().map((i) => (
        <IncomeSourceRow key={i._id} incomeSource={i} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <input style={formInputStyle} placeholder="Label — e.g. Salary" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={formInputStyle} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select style={formInputStyle} value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="annual">Annual</option>
          <option value="irregular">Irregular</option>
        </select>
        <label style={{ fontSize: "13px", color: colors.inkSoft, display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={dependable} onChange={(e) => setDependable(e.target.checked)} />
          Dependable
        </label>
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </form>
      <UploadLink label="Upload a payslip or bank statement instead" sectionHint="incomeSources" />
    </Card>
  );
}

const CADENCE_LABEL = { monthly: "mo", weekly: "wk", annual: "yr", irregular: "irregular" } as const;

// Same edit/delete pattern as InsurancePolicyRow further down — an
// inline form toggled by "Edit", saved via the real update mutation,
// never a direct DB edit.
function IncomeSourceRow({ incomeSource }: { incomeSource: Doc<"incomeSources"> }) {
  const update = useMutation(api.incomeSources.updateIncomeSource);
  const remove = useMutation(api.incomeSources.deleteIncomeSource);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(incomeSource.label);
  const [amount, setAmount] = useState(String(incomeSource.amountMinorUnits));
  const [cadence, setCadence] = useState(incomeSource.cadence);
  const [dependable, setDependable] = useState(incomeSource.reliability === "dependable");
  const [error, setError] = useState<string | null>(null);

  const { format } = useCurrency();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void update({
      incomeSourceId: incomeSource._id,
      label,
      amountMinorUnits: parseAmount(amount),
      currency: incomeSource.currency,
      cadence,
      reliability: dependable ? "dependable" : "uncertain",
    })
      .then(() => setEditing(false))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <EntryRow label={incomeSource.label} detail={`${format(incomeSource.amountMinorUnits)} / ${CADENCE_LABEL[incomeSource.cadence]} · ${incomeSource.reliability === "dependable" ? "Dependable" : "Uncertain"}`} />
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={ghostButtonStyle} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <DeleteButton onDelete={() => void remove({ incomeSourceId: incomeSource._id })} />
        </div>
      </div>
      {editing && (
        <form style={formRowStyle} onSubmit={save}>
          <input style={formInputStyle} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input style={formInputStyle} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select style={formInputStyle} value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="annual">Annual</option>
            <option value="irregular">Irregular</option>
          </select>
          <label style={{ fontSize: "13px", color: colors.inkSoft, display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={dependable} onChange={(e) => setDependable(e.target.checked)} />
            Dependable
          </label>
          <button style={addButtonStyle} type="submit">Save</button>
          {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
        </form>
      )}
    </div>
  );
}

function ExpenseSection({
  expenses,
}: {
  expenses: Doc<"expenses">[];
}) {
  const pending = useQuery(api.extractedFacts.listPendingByCategory, { category: "expenses" });
  const addExpense = useMutation(api.expenses.addExpense);
  const confirmFact = useMutation(api.extractedFacts.confirmExtractedFact);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [recurrence, setRecurrence] = useState<"monthly" | "weekly" | "annual" | "oneOff">("monthly");
  const [essential, setEssential] = useState(true);
  const [editingFactId, setEditingFactId] = useState<Id<"extractedFacts"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void addExpense({
      label,
      amountMinorUnits: parseAmount(amount),
      currency: "INR",
      classification: essential ? "essential" : "flexible",
      recurrence,
    })
      .then(async (newId) => {
        if (editingFactId) {
          await confirmFact({ factId: editingFactId, targetEntityId: newId });
          setEditingFactId(null);
        }
        setLabel("");
        setAmount("");
        setRecurrence("monthly");
        setEssential(true);
      })
      .catch((err: Error) => setError(err.message));
  };

  const startEdit = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    setLabel(claimed.label);
    setAmount(String(claimed.amountMinorUnits));
    setRecurrence("monthly");
    setEssential(true);
    setEditingFactId(fact._id);
  };

  const confirmDirectly = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    void addExpense({
      label: claimed.label,
      amountMinorUnits: claimed.amountMinorUnits,
      currency: "INR",
      classification: "essential",
      recurrence: "monthly",
    }).then((newId) => confirmFact({ factId: fact._id, targetEntityId: newId }));
  };

  return (
    <Card>
      <SectionHeading>Expenses</SectionHeading>
      {[...expenses].reverse().map((e) => (
        <ExpenseRow key={e._id} expense={e} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <input style={formInputStyle} placeholder="Label — e.g. Groceries" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={formInputStyle} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select style={formInputStyle} value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="annual">Annual</option>
          <option value="oneOff">One-off</option>
        </select>
        <label style={{ fontSize: "13px", color: colors.inkSoft, display: "flex", alignItems: "center", gap: "4px" }}>
          <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
          Essential
        </label>
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </form>
      <UploadLink label="Upload a photo or PDF instead" sectionHint="expenses" />
    </Card>
  );
}

const RECURRENCE_LABEL = { monthly: "mo", weekly: "wk", annual: "yr", oneOff: "one-off" } as const;

function ExpenseRow({ expense }: { expense: Doc<"expenses"> }) {
  const update = useMutation(api.expenses.updateExpense);
  const remove = useMutation(api.expenses.deleteExpense);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(expense.label);
  const [amount, setAmount] = useState(String(expense.amountMinorUnits));
  const [recurrence, setRecurrence] = useState(expense.recurrence);
  const [essential, setEssential] = useState(expense.classification === "essential");
  const [error, setError] = useState<string | null>(null);

  const { format } = useCurrency();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void update({
      expenseId: expense._id,
      label,
      amountMinorUnits: parseAmount(amount),
      currency: expense.currency,
      classification: essential ? "essential" : "flexible",
      recurrence,
    })
      .then(() => setEditing(false))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <EntryRow label={expense.label} detail={`${format(expense.amountMinorUnits)} / ${RECURRENCE_LABEL[expense.recurrence]} · ${expense.classification === "essential" ? "Essential" : "Flexible"}`} />
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={ghostButtonStyle} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <DeleteButton onDelete={() => void remove({ expenseId: expense._id })} />
        </div>
      </div>
      {editing && (
        <form style={formRowStyle} onSubmit={save}>
          <input style={formInputStyle} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input style={formInputStyle} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select style={formInputStyle} value={recurrence} onChange={(e) => setRecurrence(e.target.value as typeof recurrence)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="annual">Annual</option>
            <option value="oneOff">One-off</option>
          </select>
          <label style={{ fontSize: "13px", color: colors.inkSoft, display: "flex", alignItems: "center", gap: "4px" }}>
            <input type="checkbox" checked={essential} onChange={(e) => setEssential(e.target.checked)} />
            Essential
          </label>
          <button style={addButtonStyle} type="submit">Save</button>
          {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
        </form>
      )}
    </div>
  );
}

function ObligationSection({
  obligations,
}: {
  obligations: Doc<"obligations">[];
}) {
  const pending = useQuery(api.extractedFacts.listPendingByCategory, { category: "obligations" });
  const addObligation = useMutation(api.obligations.addObligation);
  const confirmFact = useMutation(api.extractedFacts.confirmExtractedFact);
  const [label, setLabel] = useState("");
  const [balance, setBalance] = useState("");
  const [emi, setEmi] = useState("");
  const [editingFactId, setEditingFactId] = useState<Id<"extractedFacts"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void addObligation({
      label,
      balanceMinorUnits: parseAmount(balance),
      emiMinorUnits: parseAmount(emi),
      currency: "INR",
      interestRateBasisPoints: 0,
      dueDayOfMonth: 1,
    })
      .then(async (newId) => {
        if (editingFactId) {
          await confirmFact({ factId: editingFactId, targetEntityId: newId });
          setEditingFactId(null);
        }
        setLabel("");
        setBalance("");
        setEmi("");
      })
      .catch((err: Error) => setError(err.message));
  };

  const startEdit = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    setLabel(claimed.label);
    setEmi(String(claimed.amountMinorUnits));
    setBalance(String(claimed.secondaryAmountMinorUnits ?? claimed.amountMinorUnits));
    setEditingFactId(fact._id);
  };

  const confirmDirectly = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    void addObligation({
      label: claimed.label,
      emiMinorUnits: claimed.amountMinorUnits,
      balanceMinorUnits: claimed.secondaryAmountMinorUnits ?? claimed.amountMinorUnits,
      currency: "INR",
      interestRateBasisPoints: 0,
      dueDayOfMonth: 1,
    }).then((newId) => confirmFact({ factId: fact._id, targetEntityId: newId }));
  };

  return (
    <Card>
      <SectionHeading>Obligations (loans/EMIs)</SectionHeading>
      {[...obligations].reverse().map((o) => (
        <ObligationRow key={o._id} obligation={o} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <input style={formInputStyle} placeholder="Label — e.g. Home loan" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={formInputStyle} placeholder="Total amount still owed" value={balance} onChange={(e) => setBalance(e.target.value)} />
        <input style={formInputStyle} placeholder="What you pay monthly" value={emi} onChange={(e) => setEmi(e.target.value)} />
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </form>
      <UploadLink label="Upload a photo or PDF instead" sectionHint="obligations" />
    </Card>
  );
}

function ObligationRow({ obligation }: { obligation: Doc<"obligations"> }) {
  const update = useMutation(api.obligations.updateObligation);
  const remove = useMutation(api.obligations.deleteObligation);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(obligation.label);
  const [balance, setBalance] = useState(String(obligation.balanceMinorUnits));
  const [emi, setEmi] = useState(String(obligation.emiMinorUnits));
  const [error, setError] = useState<string | null>(null);

  const { format } = useCurrency();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void update({
      obligationId: obligation._id,
      label,
      balanceMinorUnits: parseAmount(balance),
      emiMinorUnits: parseAmount(emi),
      currency: obligation.currency,
    })
      .then(() => setEditing(false))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <EntryRow label={obligation.label} detail={`${format(obligation.balanceMinorUnits)} owed · ${format(obligation.emiMinorUnits)}/mo paid`} />
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={ghostButtonStyle} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <DeleteButton onDelete={() => void remove({ obligationId: obligation._id })} />
        </div>
      </div>
      {editing && (
        <form style={formRowStyle} onSubmit={save}>
          <input style={formInputStyle} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input style={formInputStyle} placeholder="Total amount still owed" value={balance} onChange={(e) => setBalance(e.target.value)} />
          <input style={formInputStyle} placeholder="What you pay monthly" value={emi} onChange={(e) => setEmi(e.target.value)} />
          <button style={addButtonStyle} type="submit">Save</button>
          {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
        </form>
      )}
    </div>
  );
}

function AssetSection({
  assets,
}: {
  assets: Doc<"assets">[];
}) {
  // No upload link triggers "assets" directly (no asset mockup showed
  // one), but extraction (from an email, or a file uploaded under a
  // different section) can still categorize a fact as an asset — so
  // pending facts still need a place to be confirmed or edited.
  const pending = useQuery(api.extractedFacts.listPendingByCategory, { category: "assets" });
  const addAsset = useMutation(api.assets.addAsset);
  const confirmFact = useMutation(api.extractedFacts.confirmExtractedFact);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [liquidity, setLiquidity] = useState<"liquid" | "semiLiquid" | "illiquid">("liquid");
  const [editingFactId, setEditingFactId] = useState<Id<"extractedFacts"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void addAsset({
      label,
      valueMinorUnits: parseAmount(value),
      currency: "INR",
      liquidity,
    })
      .then(async (newId) => {
        if (editingFactId) {
          await confirmFact({ factId: editingFactId, targetEntityId: newId });
          setEditingFactId(null);
        }
        setLabel("");
        setValue("");
        setLiquidity("liquid");
      })
      .catch((err: Error) => setError(err.message));
  };

  const startEdit = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    setLabel(claimed.label);
    setValue(String(claimed.amountMinorUnits));
    setLiquidity("liquid");
    setEditingFactId(fact._id);
  };

  const confirmDirectly = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    void addAsset({
      label: claimed.label,
      valueMinorUnits: claimed.amountMinorUnits,
      currency: "INR",
      liquidity: "liquid",
    }).then((newId) => confirmFact({ factId: fact._id, targetEntityId: newId }));
  };

  return (
    <Card>
      <SectionHeading>Assets / savings</SectionHeading>
      {[...assets].reverse().map((a) => (
        <AssetRow key={a._id} asset={a} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <input style={formInputStyle} placeholder="Label — e.g. Savings account" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={formInputStyle} placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        <select style={formInputStyle} value={liquidity} onChange={(e) => setLiquidity(e.target.value as typeof liquidity)}>
          <option value="liquid">Liquid</option>
          <option value="semiLiquid">Semi-liquid</option>
          <option value="illiquid">Illiquid</option>
        </select>
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </form>
    </Card>
  );
}

const LIQUIDITY_LABEL = { liquid: "Liquid", semiLiquid: "Semi-liquid", illiquid: "Illiquid" } as const;

function AssetRow({ asset }: { asset: Doc<"assets"> }) {
  const update = useMutation(api.assets.updateAsset);
  const remove = useMutation(api.assets.deleteAsset);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(asset.label);
  const [value, setValue] = useState(String(asset.valueMinorUnits));
  const [liquidity, setLiquidity] = useState(asset.liquidity);
  const [error, setError] = useState<string | null>(null);
  const { format } = useCurrency();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void update({
      assetId: asset._id,
      label,
      valueMinorUnits: parseAmount(value),
      currency: asset.currency,
      liquidity,
    })
      .then(() => setEditing(false))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <EntryRow label={asset.label} detail={`${format(asset.valueMinorUnits)} · ${LIQUIDITY_LABEL[asset.liquidity]}`} />
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={ghostButtonStyle} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <DeleteButton onDelete={() => void remove({ assetId: asset._id })} />
        </div>
      </div>
      {editing && (
        <form style={formRowStyle} onSubmit={save}>
          <input style={formInputStyle} placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input style={formInputStyle} placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
          <select style={formInputStyle} value={liquidity} onChange={(e) => setLiquidity(e.target.value as typeof liquidity)}>
            <option value="liquid">Liquid</option>
            <option value="semiLiquid">Semi-liquid</option>
            <option value="illiquid">Illiquid</option>
          </select>
          <button style={addButtonStyle} type="submit">Save</button>
          {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
        </form>
      )}
    </div>
  );
}

function InsuranceSection({
  insurancePolicies,
}: {
  insurancePolicies: Doc<"insurancePolicies">[];
}) {
  const pending = useQuery(api.extractedFacts.listPendingByCategory, { category: "insurancePolicies" });
  const addInsurancePolicy = useMutation(api.insurance.addInsurancePolicy);
  const confirmFact = useMutation(api.extractedFacts.confirmExtractedFact);
  const [type, setType] = useState<"life" | "health" | "motor" | "property" | "personalAccident" | "other">("life");
  const [coverageAmount, setCoverageAmount] = useState("");
  const [premium, setPremium] = useState("");
  const [premiumFrequency, setPremiumFrequency] = useState<"monthly" | "annual">("annual");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [editingFactId, setEditingFactId] = useState<Id<"extractedFacts"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void addInsurancePolicy({
      type,
      coverageAmountMinorUnits: parseAmount(coverageAmount),
      premiumMinorUnits: parseAmount(premium),
      premiumFrequency,
      currency: "INR",
      insurerName: insurerName.trim() || undefined,
      policyNumber: policyNumber.trim() || undefined,
    })
      .then(async (newId) => {
        if (editingFactId) {
          await confirmFact({ factId: editingFactId, targetEntityId: newId });
          setEditingFactId(null);
        }
        setType("life");
        setCoverageAmount("");
        setPremium("");
        setPremiumFrequency("annual");
        setInsurerName("");
        setPolicyNumber("");
      })
      .catch((err: Error) => setError(err.message));
  };

  const startEdit = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    setType("other");
    setCoverageAmount(String(claimed.amountMinorUnits));
    setPremium(String(claimed.secondaryAmountMinorUnits ?? claimed.amountMinorUnits));
    setPremiumFrequency("annual");
    setInsurerName(claimed.label);
    setPolicyNumber("");
    setEditingFactId(fact._id);
  };

  const confirmDirectly = (fact: PendingFact) => {
    const claimed = fact.claimedValue as ClaimedValue;
    void addInsurancePolicy({
      type: "other",
      coverageAmountMinorUnits: claimed.amountMinorUnits,
      premiumMinorUnits: claimed.secondaryAmountMinorUnits ?? claimed.amountMinorUnits,
      premiumFrequency: "annual",
      currency: "INR",
      insurerName: claimed.label,
    }).then((newId) => confirmFact({ factId: fact._id, targetEntityId: newId }));
  };

  return (
    <Card>
      <SectionHeading>Insurance policies</SectionHeading>
      {[...insurancePolicies].reverse().map((p) => (
        <InsurancePolicyRow key={p._id} policy={p} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <select style={formInputStyle} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="life">Life</option>
          <option value="health">Health</option>
          <option value="motor">Motor</option>
          <option value="property">Property</option>
          <option value="personalAccident">Personal accident</option>
          <option value="other">Other</option>
        </select>
        <input style={formInputStyle} placeholder="Coverage amount" value={coverageAmount} onChange={(e) => setCoverageAmount(e.target.value)} />
        <input style={formInputStyle} placeholder="Premium" value={premium} onChange={(e) => setPremium(e.target.value)} />
        <select style={formInputStyle} value={premiumFrequency} onChange={(e) => setPremiumFrequency(e.target.value as typeof premiumFrequency)}>
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
        <input style={formInputStyle} placeholder="Insurer (optional)" value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
        <input style={formInputStyle} placeholder="Policy number (optional)" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
        {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
      </form>
      <UploadLink label="Upload a policy document or renewal notice instead" sectionHint="insurancePolicies" />
    </Card>
  );
}

const INSURANCE_TYPE_LABEL = { life: "Life", health: "Health", motor: "Motor", property: "Property", personalAccident: "Personal accident", other: "Other" } as const;
const PREMIUM_FREQUENCY_LABEL = { monthly: "mo", annual: "yr" } as const;

// Lets a user correct an already-confirmed policy's fields (e.g. a type
// that was defaulted to "other" during a one-click "Confirm" from an
// extracted fact — see confirmDirectly above) via the real update
// mutation, never a direct DB edit.
function InsurancePolicyRow({ policy }: { policy: Doc<"insurancePolicies"> }) {
  const update = useMutation(api.insurance.updateInsurancePolicy);
  const remove = useMutation(api.insurance.deleteInsurancePolicy);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(policy.type);
  const [coverageAmount, setCoverageAmount] = useState(String(policy.coverageAmountMinorUnits));
  const [premium, setPremium] = useState(String(policy.premiumMinorUnits));
  const [premiumFrequency, setPremiumFrequency] = useState(policy.premiumFrequency);
  const [insurerName, setInsurerName] = useState(policy.insurerName ?? "");
  const [policyNumber, setPolicyNumber] = useState(policy.policyNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const { format } = useCurrency();

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    void update({
      policyId: policy._id,
      type,
      coverageAmountMinorUnits: parseAmount(coverageAmount),
      premiumMinorUnits: parseAmount(premium),
      premiumFrequency,
      insurerName: insurerName.trim() || undefined,
      policyNumber: policyNumber.trim() || undefined,
    })
      .then(() => setEditing(false))
      .catch((err: Error) => setError(err.message));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <EntryRow
          label={`${INSURANCE_TYPE_LABEL[policy.type]}${policy.insurerName ? ` — ${policy.insurerName}` : ""}`}
          detail={`${format(policy.coverageAmountMinorUnits)} cover · ${format(policy.premiumMinorUnits)}/${PREMIUM_FREQUENCY_LABEL[policy.premiumFrequency]} premium`}
        />
        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button style={ghostButtonStyle} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <DeleteButton onDelete={() => void remove({ policyId: policy._id })} />
        </div>
      </div>
      {editing && (
        <form style={formRowStyle} onSubmit={save}>
          <select style={formInputStyle} value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="life">Life</option>
            <option value="health">Health</option>
            <option value="motor">Motor</option>
            <option value="property">Property</option>
            <option value="personalAccident">Personal accident</option>
            <option value="other">Other</option>
          </select>
          <input style={formInputStyle} placeholder="Coverage amount" value={coverageAmount} onChange={(e) => setCoverageAmount(e.target.value)} />
          <input style={formInputStyle} placeholder="Premium" value={premium} onChange={(e) => setPremium(e.target.value)} />
          <select style={formInputStyle} value={premiumFrequency} onChange={(e) => setPremiumFrequency(e.target.value as typeof premiumFrequency)}>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
          <input style={formInputStyle} placeholder="Insurer (optional)" value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
          <input style={formInputStyle} placeholder="Policy number (optional)" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          <button style={addButtonStyle} type="submit">Save</button>
          {error && <span style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</span>}
        </form>
      )}
    </div>
  );
}
