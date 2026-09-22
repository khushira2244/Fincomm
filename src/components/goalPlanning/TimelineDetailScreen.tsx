import { FormEvent, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc, Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import {
  CollapsibleSection,
  DeleteButton,
  EntryRow,
  NoEntries,
  SubLabel,
  formRowStyle,
  ghostButtonStyle,
  inputStyle,
  linkStyle,
  parseAmount,
  primaryButtonStyle,
  textareaStyle,
  useDraft,
} from "./kit";
import { useCurrency } from "../../lib/currency";

export function TimelineDetailScreen({
  householdId,
  timelineId,
  onBack,
  onAnalysisReady,
}: {
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  onBack: () => void;
  onAnalysisReady: () => void;
}) {
  const timeline = useQuery(api.goalPlanning.getTimeline, { timelineId });
  const items = useQuery(api.goalPlanning.listTimelineItems, { timelineId });

  if (timeline === undefined || items === undefined) {
    return (
      <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.inkSoft }}>
        loading…
      </main>
    );
  }
  if (timeline === null) {
    return (
      <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans }}>
        <span onClick={onBack} style={linkStyle}>
          ← Back to timelines
        </span>
        <p>Timeline not found.</p>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <span onClick={onBack} style={{ ...linkStyle, marginTop: 0 }}>
          ← Back to timelines
        </span>
        <div>
          <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>{timeline.label}</h1>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>
            {timeline.yearsLabel || "Years not set"}
          </div>
        </div>

        <SuggestionsBlock timelineId={timelineId} />

        <FamilySection
          householdId={householdId}
          timelineId={timelineId}
          support={items.familySupport}
          obligations={items.familyObligations}
          emergencyNotes={items.emergencyNotes}
        />
        <LoansSection householdId={householdId} timelineId={timelineId} loans={items.loans} />
        <CareerSection householdId={householdId} timelineId={timelineId} goals={items.careerGoals} />
        <ShortTermGoalSection
          householdId={householdId}
          timelineId={timelineId}
          goals={items.shortTermGoals}
        />
        <SimpleNoteSection
          title="Health & aging preparation"
          category="health"
          placeholder="How do you want to prepare?"
          multiline
          householdId={householdId}
          timelineId={timelineId}
          notes={items.health}
        />
        <SimpleNoteSection
          title="Location"
          category="location"
          placeholder="e.g. Move to..."
          householdId={householdId}
          timelineId={timelineId}
          notes={items.location}
        />
        <SimpleNoteSection
          title="Side income & business ideas"
          category="sideIncome"
          placeholder="What idea do you have in mind?"
          multiline
          goDeeper="→ Go deeper in Side Income & Business Planning"
          householdId={householdId}
          timelineId={timelineId}
          notes={items.sideIncome}
        />
        <SimpleNoteSection
          title="Miscellaneous"
          category="misc"
          placeholder="Anything else about this timeline"
          multiline
          defaultOpen={false}
          householdId={householdId}
          timelineId={timelineId}
          notes={items.misc}
        />

        <ConfirmAndAnalyzeCard timelineId={timelineId} onAnalysisReady={onAnalysisReady} />
      </div>
    </main>
  );
}

function ConfirmAndAnalyzeCard({
  timelineId,
  onAnalysisReady,
}: {
  timelineId: Id<"timelines">;
  onAnalysisReady: () => void;
}) {
  const setConfirmed = useMutation(api.goalPlanning.setTimelineConfirmed);
  const generateAnalysis = useAction(api.planAnalysis.generateAnalysis);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await setConfirmed({ timelineId, confirmed: true });
      await generateAnalysis({});
      onAnalysisReady();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        background: "#ffffff",
        padding: "20px 24px",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: "13px", color: colors.inkSoft, margin: "0 0 12px" }}>
        Confirming takes you straight to how this fits into your whole plan. You can come back and edit
        anytime.
      </p>
      <button style={primaryButtonStyle} disabled={busy} onClick={() => void handleConfirm()}>
        {busy ? "Analysing your plan…" : "Confirm & see my analysis"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Suggestions (amber dashed cards)
// ---------------------------------------------------------------------

const amberCardStyle = {
  border: "1px dashed #C9A44C",
  background: "#F7ECD4",
  borderRadius: "6px",
  padding: "12px 14px",
  fontSize: "13px",
};

function SuggestionsBlock({ timelineId }: { timelineId: Id<"timelines"> }) {
  const suggestions = useQuery(api.goalPlanning.getSuggestions, { timelineId });

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: colors.inkSoft,
        }}
      >
        Suggested for this timeline
      </div>
      {suggestions.map((s) => (
        <SuggestionCard key={s.key} timelineId={timelineId} suggestion={s} />
      ))}
    </div>
  );
}

type Suggestion = {
  key: string;
  kind: "carryForwardFamilySupport" | "resurfacedItem";
  category: string;
  title: string;
  body: string;
  sourceFamilySupport?: { label: string; monthlyCostMinorUnits: number };
  resurfacedItemType?: "goal" | "situation";
  resurfacedItemId?: string;
};

function SuggestionCard({
  timelineId,
  suggestion: s,
}: {
  timelineId: Id<"timelines">;
  suggestion: Suggestion;
}) {
  const addFamilySupport = useMutation(api.goalPlanning.addFamilySupport);
  const dismiss = useMutation(api.goalPlanning.dismissSuggestion);
  const acceptResurfaced = useMutation(api.goalPlanning.acceptResurfacedItem);
  const [editingAmount, setEditingAmount] = useState(false);
  const [amount, setAmount] = useState("");

  return (
    <div style={amberCardStyle}>
      <div style={{ fontWeight: 700, marginBottom: "2px" }}>{s.title}</div>
      <div style={{ marginBottom: "8px" }}>{s.body}</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        {s.kind === "carryForwardFamilySupport" ? (
          <>
            <button
              style={primaryButtonStyle}
              onClick={() =>
                void addFamilySupport({
                  timelineId,
                  label: s.sourceFamilySupport?.label ?? "",
                  monthlyCostMinorUnits: s.sourceFamilySupport?.monthlyCostMinorUnits ?? 0,
                }).then(() => dismiss({ timelineId, suggestionKey: s.key }))
              }
            >
              Same amount
            </button>
            {editingAmount ? (
              <>
                <input
                  style={{ ...inputStyle, width: "120px" }}
                  placeholder="New monthly cost"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <button
                  style={primaryButtonStyle}
                  onClick={() =>
                    void addFamilySupport({
                      timelineId,
                      label: s.sourceFamilySupport?.label ?? "",
                      monthlyCostMinorUnits: Number(amount),
                    }).then(() => dismiss({ timelineId, suggestionKey: s.key }))
                  }
                >
                  Save
                </button>
              </>
            ) : (
              <button style={ghostButtonStyle} onClick={() => setEditingAmount(true)}>
                Different amount
              </button>
            )}
            <button
              style={ghostButtonStyle}
              onClick={() => void dismiss({ timelineId, suggestionKey: s.key })}
            >
              Ends here
            </button>
          </>
        ) : (
          <>
            <button
              style={primaryButtonStyle}
              onClick={() =>
                void acceptResurfaced({
                  timelineId,
                  itemType: s.resurfacedItemType ?? "goal",
                  itemId: s.resurfacedItemId ?? "",
                })
              }
            >
              Accept
            </button>
            <button
              style={ghostButtonStyle}
              onClick={() => void dismiss({ timelineId, suggestionKey: s.key })}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Family & dependents
// ---------------------------------------------------------------------

function FamilySection({
  householdId,
  timelineId,
  support,
  obligations,
  emergencyNotes,
}: {
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  support: Doc<"timelineFamilySupport">[];
  obligations: Doc<"familyObligations">[];
  emergencyNotes: Doc<"situations">[];
}) {
  const { format } = useCurrency();
  const k = (field: string) => `${householdId}:${timelineId}:family:${field}`;
  const addSupport = useMutation(api.goalPlanning.addFamilySupport);
  const addObligation = useMutation(api.goalPlanning.addFamilyObligation);
  const addEmergency = useMutation(api.goalPlanning.addEmergencyNote);

  const supLabel = useDraft(k("supportLabel"));
  const supCost = useDraft(k("supportCost"));
  const obLabel = useDraft(k("obligationLabel"));
  const obCost = useDraft(k("obligationCost"));
  const obYears = useDraft(k("obligationYears"));
  const obReason = useDraft(k("obligationReason"));
  const emNote = useDraft(k("emergencyNote"));

  const submitSupport = (e: FormEvent) => {
    e.preventDefault();
    void addSupport({
      timelineId,
      label: supLabel.value,
      monthlyCostMinorUnits: Number(supCost.value),
    }).then(() => {
      supLabel.clear();
      supCost.clear();
    });
  };

  const submitObligation = (e: FormEvent) => {
    e.preventDefault();
    void addObligation({
      timelineId,
      label: obLabel.value,
      costPerYearMinorUnits: Number(obCost.value),
      forHowManyYears: Number(obYears.value),
      reason: obReason.value || undefined,
    }).then(() => {
      obLabel.clear();
      obCost.clear();
      obYears.clear();
      obReason.clear();
    });
  };

  const submitEmergency = (e: FormEvent) => {
    e.preventDefault();
    void addEmergency({ timelineId, description: emNote.value }).then(() => emNote.clear());
  };

  return (
    <CollapsibleSection title="Family & dependents">
      <SubLabel>Monthly support</SubLabel>
      {support.length === 0 ? (
        <NoEntries />
      ) : (
        support.map((s) => <FamilySupportRow key={s._id} support={s} />)
      )}
      <form style={formRowStyle} onSubmit={submitSupport}>
        <input
          style={inputStyle}
          placeholder="Label — e.g. Parents' support"
          value={supLabel.value}
          onChange={(e) => supLabel.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Monthly cost"
          value={supCost.value}
          onChange={(e) => supCost.setValue(e.target.value)}
        />
        <button style={primaryButtonStyle} type="submit">
          Add
        </button>
      </form>

      <SubLabel>Yearly obligations (with a reason and a set number of years)</SubLabel>
      {obligations.length === 0 ? (
        <NoEntries />
      ) : (
        obligations.map((o) => <FamilyObligationRow key={o._id} obligation={o} />)
      )}
      <form style={formRowStyle} onSubmit={submitObligation}>
        <input
          style={inputStyle}
          placeholder="Label — e.g. Home repairs"
          value={obLabel.value}
          onChange={(e) => obLabel.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Cost per year"
          value={obCost.value}
          onChange={(e) => obCost.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="For how many years"
          value={obYears.value}
          onChange={(e) => obYears.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Reason"
          value={obReason.value}
          onChange={(e) => obReason.setValue(e.target.value)}
        />
        <button style={primaryButtonStyle} type="submit">
          Add
        </button>
      </form>

      <SubLabel>Emergency or unplanned needs</SubLabel>
      <div style={{ fontSize: "12px", color: "#a13d3d", marginBottom: "6px" }}>
        Don&apos;t add these as a monthly cost — note that this risk exists, so reserve planning
        accounts for it.
      </div>
      {emergencyNotes.length === 0 ? (
        <NoEntries />
      ) : (
        emergencyNotes.map((n) => <EmergencyNoteRow key={n._id} note={n} />)
      )}
      <form style={{ ...formRowStyle, alignItems: "stretch" }} onSubmit={submitEmergency}>
        <textarea
          style={{ ...textareaStyle, flex: 1, minWidth: "260px" }}
          placeholder="e.g. A parent's health could need sudden support"
          value={emNote.value}
          onChange={(e) => emNote.setValue(e.target.value)}
        />
        <button style={primaryButtonStyle} type="submit">
          Note this risk
        </button>
      </form>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------

function LoansSection({
  householdId,
  timelineId,
  loans,
}: {
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  loans: Doc<"timelineLoans">[];
}) {
  const { format } = useCurrency();
  const k = (field: string) => `${householdId}:${timelineId}:loan:${field}`;
  const addLoan = useMutation(api.goalPlanning.addTimelineLoan);
  const label = useDraft(k("label"));
  const balance = useDraft(k("balance"));
  const emi = useDraft(k("emi"));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void addLoan({
      timelineId,
      label: label.value,
      outstandingBalanceMinorUnits: Number(balance.value),
      emiMinorUnits: Number(emi.value),
    }).then(() => {
      label.clear();
      balance.clear();
      emi.clear();
    });
  };

  return (
    <CollapsibleSection title="Loans">
      {loans.length === 0 ? (
        <NoEntries />
      ) : (
        loans.map((l) => (
          <EntryRow
            key={l._id}
            label={l.label}
            detail={`Balance ${format(l.outstandingBalanceMinorUnits)} · EMI ${format(l.emiMinorUnits)}`}
          />
        ))
      )}
      <form style={formRowStyle} onSubmit={submit}>
        <input
          style={inputStyle}
          placeholder="Label — e.g. Home loan"
          value={label.value}
          onChange={(e) => label.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Outstanding balance"
          value={balance.value}
          onChange={(e) => balance.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="EMI"
          value={emi.value}
          onChange={(e) => emi.setValue(e.target.value)}
        />
        <button style={primaryButtonStyle} type="submit">
          Add
        </button>
      </form>
      <span style={linkStyle}>📎 Upload a photo or PDF instead</span>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------
// Career & income
// ---------------------------------------------------------------------

function CareerSection({
  householdId,
  timelineId,
  goals,
}: {
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  goals: Doc<"goals">[];
}) {
  const { format } = useCurrency();
  const k = (field: string) => `${householdId}:${timelineId}:career:${field}`;
  const addCareer = useMutation(api.goalPlanning.addCareerGoal);
  const role = useDraft(k("role"));
  const income = useDraft(k("income"));
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Expected income is a plain-language rupee figure ("Expected
    // income"), so people naturally type it with commas or a ₹ prefix
    // (e.g. "15,00,000") — strip everything but digits/minus before
    // parsing so that still works, instead of silently producing NaN.
    const cleanedIncome = income.value.replace(/[^0-9.-]/g, "");
    const parsedIncome = cleanedIncome === "" ? undefined : Number(cleanedIncome);
    if (parsedIncome !== undefined && !Number.isInteger(parsedIncome)) {
      setError("Expected income must be a whole number of rupees (no decimals).");
      return;
    }
    void addCareer({
      timelineId,
      description: role.value,
      expectedIncomeMinorUnits: parsedIncome,
    })
      .then(() => {
        role.clear();
        income.clear();
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  };

  return (
    <CollapsibleSection title="Career & income">
      {goals.length === 0 ? (
        <NoEntries />
      ) : (
        goals.map((g) => (
          <EntryRow
            key={g._id}
            label={g.description}
            detail={
              g.targetAmountMinorUnits !== undefined ? `${format(g.targetAmountMinorUnits)}/yr` : undefined
            }
          />
        ))
      )}
      <form style={formRowStyle} onSubmit={submit}>
        <input
          style={inputStyle}
          placeholder="What role or change?"
          value={role.value}
          onChange={(e) => role.setValue(e.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Expected income"
          value={income.value}
          onChange={(e) => income.setValue(e.target.value)}
        />
        <button style={primaryButtonStyle} type="submit">
          Add
        </button>
      </form>
      {error && <p style={{ fontSize: "13px", color: "#a13d3d", margin: "8px 0 0" }}>{error}</p>}
      <span style={linkStyle}>→ Go deeper in Economic &amp; Role-Change Intelligence</span>
    </CollapsibleSection>
  );
}

// ---------------------------------------------------------------------
// A specific short-term goal
// ---------------------------------------------------------------------

function ShortTermGoalSection({
  householdId,
  timelineId,
  goals,
}: {
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  goals: Doc<"goals">[];
}) {
  const k = (field: string) => `${householdId}:${timelineId}:shortTermGoal:${field}`;
  const addGoal = useMutation(api.goalPlanning.addShortTermGoal);
  const name = useDraft(k("name"));
  const pos = useDraft(k("positive"));
  const neg = useDraft(k("negative"));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void addGoal({
      timelineId,
      description: name.value,
      positiveSteps: splitSteps(pos.value),
      negativeSteps: splitSteps(neg.value),
    }).then(() => {
      name.clear();
      pos.clear();
      neg.clear();
    });
  };

  return (
    <CollapsibleSection title="A specific short-term goal">
      {goals.length === 0 ? <NoEntries /> : goals.map((g) => <ShortTermGoalRow key={g._id} goal={g} />)}
      <form style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }} onSubmit={submit}>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: "220px" }}
            placeholder="Goal name — e.g. Clear the car loan"
            value={name.value}
            onChange={(e) => name.setValue(e.target.value)}
          />
          <button style={primaryButtonStyle} type="submit">
            Add
          </button>
        </div>
        <textarea
          style={textareaStyle}
          placeholder="What's helping you get there? (positive steps)"
          value={pos.value}
          onChange={(e) => pos.setValue(e.target.value)}
        />
        <textarea
          style={textareaStyle}
          placeholder="What do you think is working against you? (negative steps)"
          value={neg.value}
          onChange={(e) => neg.setValue(e.target.value)}
        />
        <div style={{ fontSize: "12px", color: colors.inkSoft }}>
          Steps typed here are saved with the goal when you press Add. Added goals have their own
          step editor below their name.
        </div>
      </form>
    </CollapsibleSection>
  );
}

function ShortTermGoalRow({ goal }: { goal: Doc<"goals"> }) {
  const updateSteps = useMutation(api.goalPlanning.updateGoalSteps);
  const [pos, setPos] = useState((goal.positiveSteps ?? []).join("\n"));
  const [neg, setNeg] = useState((goal.negativeSteps ?? []).join("\n"));
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderBottom: `1px solid ${colors.creamDim}`, padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
        <span>{goal.description}</span>
        <span onClick={() => setOpen(!open)} style={{ ...linkStyle, marginTop: 0 }}>
          {open ? "Hide steps" : "Edit steps"}
        </span>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
          <textarea
            style={textareaStyle}
            placeholder="What's helping you get there? (positive steps)"
            value={pos}
            onChange={(e) => setPos(e.target.value)}
          />
          <textarea
            style={textareaStyle}
            placeholder="What do you think is working against you? (negative steps)"
            value={neg}
            onChange={(e) => setNeg(e.target.value)}
          />
          <button
            style={{ ...primaryButtonStyle, alignSelf: "flex-start" }}
            onClick={() =>
              void updateSteps({
                goalId: goal._id,
                positiveSteps: splitSteps(pos),
                negativeSteps: splitSteps(neg),
              })
            }
          >
            Save steps
          </button>
        </div>
      )}
    </div>
  );
}

function splitSteps(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------
// Health / Location / Side income / Miscellaneous
// ---------------------------------------------------------------------

function SimpleNoteSection({
  title,
  category,
  placeholder,
  multiline = false,
  goDeeper,
  defaultOpen = true,
  householdId,
  timelineId,
  notes,
}: {
  title: string;
  category: "health" | "location" | "sideIncome" | "misc";
  placeholder: string;
  multiline?: boolean;
  goDeeper?: string;
  defaultOpen?: boolean;
  householdId: Id<"households">;
  timelineId: Id<"timelines">;
  notes: Doc<"situations">[];
}) {
  const addNote = useMutation(api.goalPlanning.addSituationNote);
  const draft = useDraft(`${householdId}:${timelineId}:${category}:note`);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void addNote({ timelineId, situationCategory: category, description: draft.value }).then(() =>
      draft.clear(),
    );
  };

  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen}>
      {notes.length === 0 ? (
        <NoEntries />
      ) : (
        notes.map((n) => <EntryRow key={n._id} label={n.description} />)
      )}
      <form style={{ ...formRowStyle, alignItems: "stretch" }} onSubmit={submit}>
        {multiline ? (
          <textarea
            style={{ ...textareaStyle, flex: 1, minWidth: "260px" }}
            placeholder={placeholder}
            value={draft.value}
            onChange={(e) => draft.setValue(e.target.value)}
          />
        ) : (
          <input
            style={{ ...inputStyle, flex: 1, minWidth: "260px" }}
            placeholder={placeholder}
            value={draft.value}
            onChange={(e) => draft.setValue(e.target.value)}
          />
        )}
        <button style={primaryButtonStyle} type="submit">
          Add
        </button>
      </form>
      {goDeeper && <span style={linkStyle}>{goDeeper}</span>}
    </CollapsibleSection>
  );
}
