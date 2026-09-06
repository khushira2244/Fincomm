import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Doc, Id } from "../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../theme";
import { EmptyState } from "./EmptyState";

// All data access below (useQuery/useMutation calls, the `now`-ticking
// runway argument, the integer-minor-units payloads) is unchanged from
// the previous build — only rendering/styling is new.

export function FinancialFoundationScreen() {
  const incomeSources = useQuery(api.incomeSources.listIncomeSources);
  const expenses = useQuery(api.expenses.listExpenses);
  const obligations = useQuery(api.obligations.listObligations);
  const assets = useQuery(api.assets.listAssets);
  const [revealed, setRevealed] = useState(false);

  const stillLoading =
    incomeSources === undefined ||
    expenses === undefined ||
    obligations === undefined ||
    assets === undefined;

  const hasAnyData =
    !stillLoading &&
    (incomeSources.length > 0 || expenses.length > 0 || obligations.length > 0 || assets.length > 0);

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
        {runway === undefined ? "calculating..." : runway.status === "not_depleting" ? "reserves are not being depleted" : `${runway.runwayMonths.toFixed(1)} months`}
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
  return (
    <div>
      <div style={{ fontSize: "18px", fontWeight: 700 }}>₹{value.toLocaleString("en-IN")}</div>
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
  category: "incomeSources" | "expenses" | "obligations" | "assets";
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
        📎 Found in your {fact.sourceType}: <strong>{claimed.label}</strong> — ₹
        {claimed.amountMinorUnits.toLocaleString("en-IN")}
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

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void addIncomeSource({
      label,
      amountMinorUnits: Number(amount),
      currency: "INR",
      cadence,
      reliability: dependable ? "dependable" : "uncertain",
      activeFrom: Date.now(),
    }).then(async (newId) => {
      if (editingFactId) {
        await confirmFact({ factId: editingFactId, targetEntityId: newId });
        setEditingFactId(null);
      }
      setLabel("");
      setAmount("");
      setCadence("monthly");
      setDependable(true);
    });
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

  const cadenceLabel = { monthly: "mo", weekly: "wk", annual: "yr", irregular: "irregular" };

  return (
    <Card>
      <SectionHeading>Income sources</SectionHeading>
      {incomeSources.map((i) => (
        <EntryRow key={i._id} label={i.label} detail={`₹${i.amountMinorUnits.toLocaleString("en-IN")} / ${cadenceLabel[i.cadence]} · ${i.reliability === "dependable" ? "Dependable" : "Uncertain"}`} />
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
      </form>
      <UploadLink label="Upload a payslip or bank statement instead" sectionHint="incomeSources" />
    </Card>
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

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void addExpense({
      label,
      amountMinorUnits: Number(amount),
      currency: "INR",
      classification: essential ? "essential" : "flexible",
      recurrence,
    }).then(async (newId) => {
      if (editingFactId) {
        await confirmFact({ factId: editingFactId, targetEntityId: newId });
        setEditingFactId(null);
      }
      setLabel("");
      setAmount("");
      setRecurrence("monthly");
      setEssential(true);
    });
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

  const recurrenceLabel = { monthly: "mo", weekly: "wk", annual: "yr", oneOff: "one-off" };

  return (
    <Card>
      <SectionHeading>Expenses</SectionHeading>
      {expenses.map((e) => (
        <EntryRow key={e._id} label={e.label} detail={`₹${e.amountMinorUnits.toLocaleString("en-IN")} / ${recurrenceLabel[e.recurrence]} · ${e.classification === "essential" ? "Essential" : "Flexible"}`} />
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
      </form>
      <UploadLink label="Upload a photo or PDF instead" sectionHint="expenses" />
    </Card>
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

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void addObligation({
      label,
      balanceMinorUnits: Number(balance),
      emiMinorUnits: Number(emi),
      currency: "INR",
      interestRateBasisPoints: 0,
      dueDayOfMonth: 1,
    }).then(async (newId) => {
      if (editingFactId) {
        await confirmFact({ factId: editingFactId, targetEntityId: newId });
        setEditingFactId(null);
      }
      setLabel("");
      setBalance("");
      setEmi("");
    });
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
      {obligations.map((o) => (
        <EntryRow key={o._id} label={o.label} detail={`Balance ₹${o.balanceMinorUnits.toLocaleString("en-IN")} · EMI ₹${o.emiMinorUnits.toLocaleString("en-IN")}`} />
      ))}
      {pending?.map((fact) => (
        <PendingFactCard key={fact._id} fact={fact} onEdit={() => startEdit(fact)} onConfirm={() => confirmDirectly(fact)} />
      ))}
      <form style={formRowStyle} onSubmit={submit}>
        <input style={formInputStyle} placeholder="Label — e.g. Home loan" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input style={formInputStyle} placeholder="Outstanding balance" value={balance} onChange={(e) => setBalance(e.target.value)} />
        <input style={formInputStyle} placeholder="EMI" value={emi} onChange={(e) => setEmi(e.target.value)} />
        <button style={addButtonStyle} type="submit">{editingFactId ? "Confirm" : "Add"}</button>
      </form>
      <UploadLink label="Upload a photo or PDF instead" sectionHint="obligations" />
    </Card>
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

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void addAsset({
      label,
      valueMinorUnits: Number(value),
      currency: "INR",
      liquidity,
    }).then(async (newId) => {
      if (editingFactId) {
        await confirmFact({ factId: editingFactId, targetEntityId: newId });
        setEditingFactId(null);
      }
      setLabel("");
      setValue("");
      setLiquidity("liquid");
    });
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

  const liquidityLabel = { liquid: "Liquid", semiLiquid: "Semi-liquid", illiquid: "Illiquid" };

  return (
    <Card>
      <SectionHeading>Assets / savings</SectionHeading>
      {assets.map((a) => (
        <EntryRow key={a._id} label={a.label} detail={`₹${a.valueMinorUnits.toLocaleString("en-IN")} · ${liquidityLabel[a.liquidity]}`} />
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
      </form>
    </Card>
  );
}
