import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, CollapsibleSection, ghostButtonStyle, inputStyle, primaryButtonStyle, useDraft } from "../goalPlanning/kit";

// =====================================================================
// Side-Income & Business Planning — frontend rebuild to match the 4
// mockup screens exactly, wired to the existing, already-verified
// backend in convex/sideIncome.ts. Local navigation only (this screen
// owns 4 internal "pages"; App.tsx just knows "sideIncome" is active,
// same as every other service's own internal tabs/routes).
// =====================================================================

const rupee = (minor: number | null | undefined) =>
  minor === null || minor === undefined ? "—" : `₹${Math.round(minor).toLocaleString("en-IN")}`;

const FC_AMBER = "#8A6D3B";
const FC_AMBER_BG = "#F5EBD8";
const FC_RED = "#A23B2E";

const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };
const cell: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "3px", fontSize: "12px", color: colors.inkSoft };

function StepBadge({ n }: { n: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        background: colors.deepGreen,
        color: colors.cream,
        fontSize: "12px",
        fontWeight: 700,
        marginRight: "8px",
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  );
}

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: fontSerif, fontSize: "16px", marginBottom: "10px" }}>
      <StepBadge n={n} />
      {children}
    </div>
  );
}

function NoticeBox({ children, tone = "amber" }: { children: React.ReactNode; tone?: "amber" | "red" }) {
  return (
    <div
      style={{
        background: FC_AMBER_BG,
        border: `1px dashed ${tone === "red" ? FC_RED : FC_AMBER}`,
        borderRadius: radius,
        padding: "8px 12px",
        fontSize: "12.5px",
        color: colors.ink,
        marginBottom: "12px",
      }}
    >
      {children}
    </div>
  );
}

const RoughEstimateBadge = () => (
  <span
    style={{
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.03em",
      textTransform: "uppercase",
      color: FC_AMBER,
      background: FC_AMBER_BG,
      border: `1px solid ${FC_AMBER}`,
      borderRadius: "10px",
      padding: "2px 8px",
      marginLeft: "8px",
    }}
  >
    Rough estimate
  </span>
);

// =====================================================================
// Local navigation between the 4 screens
// =====================================================================

type SIView =
  | { screen: "main" }
  | { screen: "combined"; entryId: Id<"sideIncomeEntries">; opportunityIds: Id<"sideIncomeOpportunities">[] }
  | { screen: "gettingStarted"; entryId: Id<"sideIncomeEntries">; opportunityId?: Id<"sideIncomeOpportunities"> }
  | { screen: "deepDive"; entryId: Id<"sideIncomeEntries">; opportunityId?: Id<"sideIncomeOpportunities">; topic: string; back: SIView };

export function SideIncomeScreen() {
  const [view, setView] = useState<SIView>({ screen: "main" });

  if (view.screen === "combined") {
    return (
      <ScreenShell>
        <CombinedPlanScreen
          entryId={view.entryId}
          opportunityIds={view.opportunityIds}
          onBack={() => setView({ screen: "main" })}
          onOpenDeepDive={(topic, opportunityId) => setView({ screen: "deepDive", entryId: view.entryId, opportunityId, topic, back: view })}
        />
      </ScreenShell>
    );
  }
  if (view.screen === "gettingStarted") {
    return (
      <ScreenShell>
        <GettingStartedScreen
          entryId={view.entryId}
          opportunityId={view.opportunityId}
          onBack={() => setView({ screen: "main" })}
          onOpenDeepDive={(topic) => setView({ screen: "deepDive", entryId: view.entryId, opportunityId: view.opportunityId, topic, back: view })}
        />
      </ScreenShell>
    );
  }
  if (view.screen === "deepDive") {
    return (
      <ScreenShell>
        <DeepDiveScreen entryId={view.entryId} opportunityId={view.opportunityId} topic={view.topic} onBack={() => setView(view.back)} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <MainScreen
        onCombine={(entryId, opportunityIds) => setView({ screen: "combined", entryId, opportunityIds })}
        onSingle={(entryId, opportunityId) => setView({ screen: "gettingStarted", entryId, opportunityId })}
      />
    </ScreenShell>
  );
}

// Persistent chrome (sidebar comes from App.tsx already; this just gives
// every internal page the same <main> wrapper the other services use).
function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "860px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>{children}</div>
    </main>
  );
}

// =====================================================================
// Screen 1 — main screen (Job tab / Business tab)
// =====================================================================

function MainScreen({
  onCombine,
  onSingle,
}: {
  onCombine: (entryId: Id<"sideIncomeEntries">, opportunityIds: Id<"sideIncomeOpportunities">[]) => void;
  onSingle: (entryId: Id<"sideIncomeEntries">, opportunityId?: Id<"sideIncomeOpportunities">) => void;
}) {
  const [tab, setTab] = useState<"job" | "business">("job");
  return (
    <>
      <div>
        <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 2px" }}>Side-Income &amp; Business Planning</h1>
        <div style={{ fontSize: "13px", color: colors.inkSoft }}>
          Find a realistic way to earn more, whether that's a few extra hours a week or a real venture.
        </div>
      </div>
      <div style={{ display: "flex", gap: "6px", borderBottom: `1px solid ${colors.sageGreen}` }}>
        {(
          [
            ["job", "Part-Time / Weekend Job"],
            ["business", "Business / Venture"],
          ] as [typeof tab, string][]
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
      {tab === "job" ? <JobPanel onCombine={onCombine} onSingle={onSingle} /> : <BusinessPanel onOpen={onSingle} />}
    </>
  );
}

// ---------------------------------------------------------------------
// Job tab: 4 numbered steps
// ---------------------------------------------------------------------

function JobPanel({
  onCombine,
  onSingle,
}: {
  onCombine: (entryId: Id<"sideIncomeEntries">, opportunityIds: Id<"sideIncomeOpportunities">[]) => void;
  onSingle: (entryId: Id<"sideIncomeEntries">, opportunityId?: Id<"sideIncomeOpportunities">) => void;
}) {
  const typeOfWork = useDraft("sideIncome:job:typeOfWork");
  const hoursPerWeek = useDraft("sideIncome:job:hoursPerWeek");
  const availabilityWindow = useDraft("sideIncome:job:availabilityWindow");
  const targetAmount = useDraft("sideIncome:job:targetAmount");
  const specificAsk = useDraft("sideIncome:job:specificAsk");

  const create = useMutation(api.sideIncome.createSideIncomeEntry);
  const update = useMutation(api.sideIncome.updateSideIncomeEntry);
  const estimate = useAction(api.sideIncome.estimateJobIncomeRange);
  const build = useMutation(api.sideIncome.buildCombinedPlan);

  const [entryId, setEntryId] = useState<Id<"sideIncomeEntries"> | null>(null);
  const opportunities = useQuery(api.sideIncome.listOpportunitiesForEntry, entryId ? { entryId } : "skip") as
    | Array<{ _id: Id<"sideIncomeOpportunities">; title: string; mode: string; fitHoursPerWeek: number; estimateLowMinorUnits: number; estimateHighMinorUnits: number; isRoughEstimate: boolean }>
    | undefined;
  const [reasoningByOpp, setReasoningByOpp] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [insufficient, setInsufficient] = useState<string | null>(null);

  const hasSearched = entryId !== null;

  const findIdeas = async (overrideTypeOfWork?: string) => {
    setBusy(true);
    setInsufficient(null);
    try {
      let id = entryId;
      if (id === null) {
        id = await create({
          kind: "job",
          typeOfWork: (overrideTypeOfWork ?? typeOfWork.value).trim() || undefined,
          hoursPerWeek: hoursPerWeek.value.trim() === "" ? undefined : Number(hoursPerWeek.value),
          availabilityWindow: availabilityWindow.value || undefined,
          rateKnown: false,
          targetAmountMinorUnits: targetAmount.value.trim() === "" ? undefined : Number(targetAmount.value),
        });
        setEntryId(id);
      } else if (overrideTypeOfWork !== undefined) {
        await update({ entryId: id, typeOfWork: overrideTypeOfWork.trim() || undefined });
      }
      const r = (await estimate({ entryId: id })) as
        | { state: "COMPUTED"; opportunities: { opportunityId: Id<"sideIncomeOpportunities">; reasoning: string }[] }
        | { state: "SOURCE_UNAVAILABLE" | "INSUFFICIENT_SIGNAL"; reason: string };
      if (r.state === "COMPUTED") {
        setReasoningByOpp((prev) => {
          const next = { ...prev };
          for (const o of r.opportunities) next[o.opportunityId] = o.reasoning;
          return next;
        });
      } else {
        setInsufficient(r.reason);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const target = targetAmount.value.trim() === "" ? null : Number(targetAmount.value);
  const totalHighOfAll = (opportunities ?? []).reduce((s, o) => s + o.estimateHighMinorUnits, 0);
  const fallsShort = target !== null && opportunities !== undefined && opportunities.length > 0 && totalHighOfAll < target;

  const selectedCount = selected.size;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <StepHeading n={1}>What kind of work?</StepHeading>
        <NoticeBox>Not sure yet? That's fine — leave this blank and we'll work from your time and target amount instead.</NoticeBox>
        <label style={cell}>
          Type of work (optional)
          <input style={f} value={typeOfWork.value} onChange={(e) => typeOfWork.setValue(e.target.value)} placeholder="Leave blank if you're not sure" />
        </label>
      </Card>

      <Card>
        <StepHeading n={2}>Time available</StepHeading>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <label style={cell}>
            Hours per week
            <input style={f} value={hoursPerWeek.value} onChange={(e) => hoursPerWeek.setValue(e.target.value)} placeholder="e.g. 6" />
          </label>
          <label style={cell}>
            When
            <select style={f} value={availabilityWindow.value} onChange={(e) => availabilityWindow.setValue(e.target.value)}>
              <option value="">Choose…</option>
              <option value="Weekday evenings">Weekday evenings</option>
              <option value="Weekday mornings">Weekday mornings</option>
              <option value="Weekends">Weekends</option>
              <option value="Flexible / anytime">Flexible / anytime</option>
            </select>
          </label>
        </div>
      </Card>

      <Card>
        <StepHeading n={3}>How much extra do you need?</StepHeading>
        <label style={cell}>
          Target amount (₹/month)
          <input style={f} value={targetAmount.value} onChange={(e) => targetAmount.setValue(e.target.value)} placeholder="e.g. 15000" />
        </label>
        <button
          style={{ ...primaryButtonStyle, marginTop: "12px" }}
          disabled={busy || hoursPerWeek.value.trim() === ""}
          onClick={() => void findIdeas()}
        >
          {busy ? "Finding ideas…" : "Find ideas"}
        </button>
      </Card>

      {hasSearched && (
        <Card>
          <StepHeading n={4}>
            General ideas that fit {hoursPerWeek.value || "?"} hrs/week{target !== null && <> and {rupee(target)}/month</>}
          </StepHeading>
          {typeOfWork.value.trim() === "" && (
            <p style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "-4px" }}>
              No specific skill was given, so these are broad categories anyone could realistically start with — not matched to a particular
              ability.
            </p>
          )}

          {insufficient && <NoticeBox tone="red">{insufficient}</NoticeBox>}

          {opportunities === undefined ? (
            <p style={{ color: colors.inkSoft, fontSize: "13px" }}>loading…</p>
          ) : (
            opportunities.map((o) => (
              <div
                key={o._id}
                style={{
                  border: `1px solid ${colors.sageGreen}`,
                  borderRadius: radius,
                  padding: "12px 14px",
                  marginBottom: "10px",
                }}
              >
                <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(o._id)} onChange={() => toggle(o._id)} style={{ marginTop: "3px" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: "14px" }}>
                      {o.title} — {o.mode}
                      {o.isRoughEstimate && <RoughEstimateBadge />}
                    </div>
                    <div style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "2px" }}>
                      Fits {o.fitHoursPerWeek} hrs/wk · Realistic range {rupee(o.estimateLowMinorUnits)}–{rupee(o.estimateHighMinorUnits)}/mo
                    </div>
                    {reasoningByOpp[o._id] && (
                      <details style={{ marginTop: "6px", fontSize: "12px" }}>
                        <summary style={{ cursor: "pointer", color: colors.midGreen }}>Why this fits</summary>
                        <div style={{ color: colors.inkSoft, marginTop: "4px" }}>{reasoningByOpp[o._id]}</div>
                      </details>
                    )}
                  </div>
                </label>
              </div>
            ))
          )}

          {fallsShort && (
            <NoticeBox>
              These broad options may fall short of {rupee(target)}/month alone.
              <div style={{ marginTop: "4px" }}>
                Select two above to see if combining them gets you closer to your target — or tell us a specific skill you have.
              </div>
            </NoticeBox>
          )}

          {opportunities !== undefined && opportunities.length > 0 && (
            <button
              style={primaryButtonStyle}
              disabled={selectedCount === 0}
              onClick={() => {
                if (entryId === null) return;
                const ids = [...selected] as Id<"sideIncomeOpportunities">[];
                if (ids.length >= 2) {
                  void build({
                    opportunityIds: ids,
                    availableHoursPerWeek: Number(hoursPerWeek.value || 0),
                    targetIncomeMinorUnits: target ?? undefined,
                  }).then(() => onCombine(entryId, ids));
                } else {
                  onSingle(entryId, ids[0]);
                }
              }}
            >
              {selectedCount >= 2 ? `Get started on both` : selectedCount === 1 ? "Get started" : "Select an idea to continue"}
            </button>
          )}

          <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: `1px solid ${colors.creamDim}` }}>
            <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "6px" }}>Something more specific in mind?</div>
            <p style={{ fontSize: "12px", color: colors.inkSoft, margin: "0 0 8px" }}>
              Tell us what you're looking for, and if it needs a specialised platform or agency, we'll point you to the right kind — not a
              generic search.
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                style={f}
                value={specificAsk.value}
                onChange={(e) => specificAsk.setValue(e.target.value)}
                placeholder="e.g. graphic design gigs, delivery driving…"
              />
              <button
                style={primaryButtonStyle}
                disabled={busy || specificAsk.value.trim() === ""}
                onClick={() => void findIdeas(specificAsk.value)}
              >
                Find the right fit
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Business tab: single-idea form → straight to Getting Started (Screen 3)
// ---------------------------------------------------------------------

function BusinessPanel({ onOpen }: { onOpen: (entryId: Id<"sideIncomeEntries">, opportunityId?: Id<"sideIncomeOpportunities">) => void }) {
  const ideaDescription = useDraft("sideIncome:business:ideaDescription");
  const startupCapital = useDraft("sideIncome:business:startupCapital");
  const effortHours = useDraft("sideIncome:business:effortHours");
  const rampUp = useDraft("sideIncome:business:rampUp");

  const create = useMutation(api.sideIncome.createSideIncomeEntry);
  const checkReserve = useAction(api.sideIncome.checkBusinessReserve);
  const [reserveResult, setReserveResult] = useState<{ hasConflict: boolean; conflictDetail: string; reserveAfterMinorUnits: number } | null>(null);
  const [entryId, setEntryId] = useState<Id<"sideIncomeEntries"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const id = await create({
        kind: "business",
        ideaDescription: ideaDescription.value.trim() || undefined,
        startupCapitalMinorUnits: startupCapital.value.trim() === "" ? undefined : Number(startupCapital.value),
        effortHoursPerWeek: effortHours.value.trim() === "" ? undefined : Number(effortHours.value),
        rampUpMonths: rampUp.value.trim() === "" ? undefined : Number(rampUp.value),
      });
      setEntryId(id);
      const r = (await checkReserve({ entryId: id })) as { hasConflict: boolean; conflictDetail: string; reserveAfterMinorUnits: number };
      setReserveResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Card>
        <StepHeading n={1}>What's the idea?</StepHeading>
        <label style={cell}>
          Idea description
          <input style={f} value={ideaDescription.value} onChange={(e) => ideaDescription.setValue(e.target.value)} placeholder="e.g. home-based tiffin service" />
        </label>
      </Card>
      <Card>
        <StepHeading n={2}>Startup capital &amp; effort</StepHeading>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <label style={cell}>
            Startup capital (₹)
            <input style={f} value={startupCapital.value} onChange={(e) => startupCapital.setValue(e.target.value)} placeholder="e.g. 30000" />
          </label>
          <label style={cell}>
            Effort hours/week
            <input style={f} value={effortHours.value} onChange={(e) => effortHours.setValue(e.target.value)} placeholder="e.g. 15" />
          </label>
          <label style={cell}>
            Ramp-up (months)
            <input style={f} value={rampUp.value} onChange={(e) => rampUp.setValue(e.target.value)} placeholder="e.g. 3" />
          </label>
        </div>
        <button style={{ ...primaryButtonStyle, marginTop: "12px" }} disabled={busy || ideaDescription.value.trim() === ""} onClick={() => void submit()}>
          {busy ? "Checking…" : "Check my idea"}
        </button>
        {error && <p style={{ color: "#a13d3d", fontSize: "12px" }}>{error}</p>}
      </Card>

      {reserveResult && entryId && (
        <Card>
          <StepHeading n={3}>Startup capital vs. your reserves</StepHeading>
          <div
            style={{
              padding: "12px",
              borderRadius: radius,
              background: reserveResult.hasConflict ? FC_AMBER_BG : "#DCEAE2",
              border: `1px solid ${reserveResult.hasConflict ? FC_AMBER : colors.midGreen}`,
              fontSize: "13px",
            }}
          >
            {reserveResult.hasConflict ? (
              <>
                <strong>This would strain your reserves.</strong> {reserveResult.conflictDetail}
              </>
            ) : (
              <>This fits comfortably — reserve after startup capital would be {rupee(reserveResult.reserveAfterMinorUnits)}.</>
            )}
          </div>
          <button style={{ ...primaryButtonStyle, marginTop: "12px" }} onClick={() => onOpen(entryId)}>
            Get started
          </button>
        </Card>
      )}
    </div>
  );
}

// =====================================================================
// Screen 2 — Combined plan
// =====================================================================

function CombinedPlanScreen({
  entryId,
  opportunityIds,
  onBack,
  onOpenDeepDive,
}: {
  entryId: Id<"sideIncomeEntries">;
  opportunityIds: Id<"sideIncomeOpportunities">[];
  onBack: () => void;
  onOpenDeepDive: (topic: string, opportunityId: Id<"sideIncomeOpportunities">) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunities = (useQuery(api.sideIncome.listOpportunitiesForEntry, { entryId }) as any[] | undefined)?.filter((o) =>
    opportunityIds.includes(o._id),
  );
  const entries = useQuery(api.sideIncome.listSideIncomeEntries) as Array<{ _id: Id<"sideIncomeEntries">; hoursPerWeek?: number; targetAmountMinorUnits?: number }> | undefined;
  const entry = entries?.find((e) => e._id === entryId);
  const build = useMutation(api.sideIncome.buildCombinedPlan);
  const update = useMutation(api.sideIncome.updateSideIncomeEntry);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [plan, setPlan] = useState<any | null>(null);
  const [activeOppId, setActiveOppId] = useState<string | null>(opportunityIds[0] ?? null);
  const [addedAsActive, setAddedAsActive] = useState(false);

  // Recompute the combined banner whenever we land here (cheap, and
  // reflects the current selection even if the user got here without a
  // prior buildCombinedPlan call).
  useEffect(() => {
    if (!entry) return;
    void build({
      opportunityIds,
      availableHoursPerWeek: entry.hoursPerWeek ?? 0,
      targetIncomeMinorUnits: entry.targetAmountMinorUnits,
    }).then(setPlan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?._id]);

  const activeOpp = opportunities?.find((o) => o._id === activeOppId);

  return (
    <>
      <BackLink onClick={onBack} label="Back to ideas" />
      <h1 style={{ fontFamily: fontSerif, fontSize: "24px", margin: "0 0 2px" }}>Your combined plan</h1>
      <div style={{ fontSize: "13px", color: colors.inkSoft }}>{opportunities?.map((o) => o.title).join(" + ")}</div>

      {plan && (
        <div style={{ background: colors.deepGreen, color: colors.cream, borderRadius: radius, padding: "16px 20px", display: "flex", gap: "32px", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "11px", letterSpacing: "0.05em", textTransform: "uppercase", color: colors.sageGreen }}>Combined</div>
          </div>
          <Stat label="Total time" value={`${plan.totalHoursPerWeek} hrs/wk`} light />
          <Stat label="Total monthly range" value={`${rupee(plan.totalIncomeLowMinorUnits)}–${rupee(plan.totalIncomeHighMinorUnits)}`} light />
          <Stat label="Options selected" value={String(opportunityIds.length)} light />
          {plan.hasTimeConflict && <Stat label="⚠" value="Time conflict with your available hours" light />}
          {plan.hasShortfallVsTarget && <Stat label="⚠" value="May fall short of your target" light />}
        </div>
      )}

      <div style={{ display: "flex", gap: "6px", borderBottom: `1px solid ${colors.sageGreen}` }}>
        {opportunities?.map((o) => (
          <button
            key={o._id}
            onClick={() => setActiveOppId(o._id)}
            style={{
              fontFamily: fontSans,
              fontSize: "13px",
              fontWeight: activeOppId === o._id ? 700 : 500,
              color: activeOppId === o._id ? colors.deepGreen : colors.inkSoft,
              background: "none",
              border: "none",
              borderBottom: `2px solid ${activeOppId === o._id ? colors.deepGreen : "transparent"}`,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            {o.title} <span style={{ fontSize: "11px", color: colors.inkSoft }}>({o.fitHoursPerWeek} hrs)</span>
          </button>
        ))}
      </div>

      {activeOpp && (
        <JobTopicAccordions
          entryId={entryId}
          opportunityId={activeOpp._id}
          onDeepDive={(topic) => onOpenDeepDive(topic, activeOpp._id)}
          hideAskAndConsult
        />
      )}

      <p style={{ fontSize: "11px", color: colors.inkSoft, fontStyle: "italic" }}>
        Questions or a real person's help are available below — shared across both, no need to ask twice.
      </p>
      <AskBox entryId={entryId} />
      <ConsultBox entryId={entryId} topic="combined plan" />

      <button
        style={primaryButtonStyle}
        disabled={addedAsActive}
        onClick={() => {
          void update({ entryId, status: "active" }).then(() => setAddedAsActive(true));
        }}
      >
        {addedAsActive ? "Added as active plans ✓" : "Add both as active plans"}
      </button>
    </>
  );
}

function Stat({ label, value, light }: { label: string; value: string; light?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: "16px", fontWeight: 700, fontFamily: fontSerif, color: light ? colors.cream : colors.ink }}>{value}</div>
      <div style={{ fontSize: "11px", color: light ? colors.sageGreen : colors.inkSoft }}>{label}</div>
    </div>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <span onClick={onClick} style={{ fontSize: "13px", color: colors.deepGreen, cursor: "pointer", textDecoration: "underline" }}>
      ← {label}
    </span>
  );
}

// =====================================================================
// Screen 3 — single-option "Getting Started" detail page
// =====================================================================

function GettingStartedScreen({
  entryId,
  opportunityId,
  onBack,
  onOpenDeepDive,
}: {
  entryId: Id<"sideIncomeEntries">;
  opportunityId?: Id<"sideIncomeOpportunities">;
  onBack: () => void;
  onOpenDeepDive: (topic: string) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = useQuery(api.sideIncome.getSideIncomeEntry, { entryId }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opportunity = useQuery(api.sideIncome.getOpportunity, opportunityId ? { opportunityId } : "skip") as any;

  if (entry === undefined) return <p style={{ color: colors.inkSoft }}>loading…</p>;

  const title = opportunity ? opportunity.title : entry.kind === "business" ? entry.ideaDescription : entry.typeOfWork || "Your plan";
  const subtitle =
    entry.kind === "job"
      ? `Fits your ${entry.hoursPerWeek ?? "?"} hrs/week${opportunity ? ` · realistic range ${rupee(opportunity.estimateLowMinorUnits)}–${rupee(opportunity.estimateHighMinorUnits)}/mo` : ""}`
      : `Startup capital ${rupee(entry.startupCapitalMinorUnits)} · ${entry.effortHoursPerWeek ?? "?"} hrs/week`;

  return (
    <>
      <BackLink onClick={onBack} label="Back to ideas" />
      <h1 style={{ fontFamily: fontSerif, fontSize: "24px", margin: "0 0 2px" }}>{title} — Getting Started</h1>
      <div style={{ fontSize: "13px", color: colors.inkSoft }}>{subtitle}</div>

      {entry.kind === "job" ? (
        <JobTopicAccordions entryId={entryId} opportunityId={opportunityId} onDeepDive={onOpenDeepDive} />
      ) : (
        <BusinessTopicAccordions entryId={entryId} onDeepDive={onOpenDeepDive} />
      )}

      <AskFlowCard entryId={entryId} />
    </>
  );
}

const JOB_TOPICS: [string, string][] = [
  ["howToStart", "How to start"],
  ["whereToApply", "Where to apply"],
  ["challenges", "Challenges to expect"],
  ["resources", "Resources & links"],
  ["motivation", "Motivation & videos"],
  ["blogs", "Blogs worth reading"],
];
const BUSINESS_TOPICS: [string, string][] = [
  ["ideaViability", "Idea viability"],
  ["startupCapital", "Startup capital"],
  ["schemeEligibility", "Scheme eligibility"],
  ["localViability", "Local viability"],
  ["maturityPath", "Maturity path"],
];

function JobTopicAccordions({
  entryId,
  opportunityId,
  onDeepDive,
  hideAskAndConsult,
}: {
  entryId: Id<"sideIncomeEntries">;
  opportunityId?: Id<"sideIncomeOpportunities">;
  onDeepDive: (topic: string) => void;
  hideAskAndConsult?: boolean;
}) {
  return (
    <>
      {JOB_TOPICS.map(([key, label], i) => (
        <CollapsibleSection key={key} title={label} defaultOpen={i === 0}>
          <TopicPreview entryId={entryId} opportunityId={opportunityId} topic={key} onDeepDive={() => onDeepDive(key)} />
        </CollapsibleSection>
      ))}
      {!hideAskAndConsult && null}
    </>
  );
}

function BusinessTopicAccordions({ entryId, onDeepDive }: { entryId: Id<"sideIncomeEntries">; onDeepDive: (topic: string) => void }) {
  return (
    <>
      {BUSINESS_TOPICS.map(([key, label], i) => (
        <CollapsibleSection key={key} title={label} defaultOpen={i === 0}>
          <TopicPreview entryId={entryId} topic={key} onDeepDive={() => onDeepDive(key)} />
        </CollapsibleSection>
      ))}
    </>
  );
}

// A short preview inside each accordion — generates on first open, shows
// the real (cached-if-available) summary, and offers the full deep dive.
function TopicPreview({
  entryId,
  opportunityId,
  topic,
  onDeepDive,
}: {
  entryId: Id<"sideIncomeEntries">;
  opportunityId?: Id<"sideIncomeOpportunities">;
  topic: string;
  onDeepDive: () => void;
}) {
  const generate = useAction(api.sideIncome.generateDeepDive);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    void generate({ sideIncomeEntryId: entryId, opportunityId, topic })
      .then((r) => setResult(r))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, opportunityId, topic]);

  return (
    <div>
      {busy && <p style={{ fontSize: "13px", color: colors.inkSoft }}>Searching…</p>}
      {result && result.state === "SOURCE_UNAVAILABLE" && <p style={{ fontSize: "13px", color: "#a15c1e" }}>{result.reason}</p>}
      {result && result.state === "COMPUTED" && (
        <>
          <p style={{ fontSize: "13px", margin: "0 0 8px" }}>{result.summary}</p>
          {(result.sections ?? []).slice(0, 1).map((s: { heading: string; detail: string }, i: number) => (
            <div key={i} style={{ fontSize: "13px", marginBottom: "8px" }}>
              <strong>{s.heading}</strong>
              <div style={{ color: colors.inkSoft }}>{s.detail}</div>
            </div>
          ))}
        </>
      )}
      <button style={{ ...ghostButtonStyle, borderStyle: "dashed", marginTop: "6px" }} onClick={onDeepDive}>
        🔍 Deep dive into this
      </button>
    </div>
  );
}

// =====================================================================
// Screen 4 — deep-dive destination page
// =====================================================================

function DeepDiveScreen({
  entryId,
  opportunityId,
  topic,
  onBack,
}: {
  entryId: Id<"sideIncomeEntries">;
  opportunityId?: Id<"sideIncomeOpportunities">;
  topic: string;
  onBack: () => void;
}) {
  const generate = useAction(api.sideIncome.generateDeepDive);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    void generate({ sideIncomeEntryId: entryId, opportunityId, topic })
      .then(setResult)
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, opportunityId, topic]);

  const topicLabel = [...JOB_TOPICS, ...BUSINESS_TOPICS].find((t) => t[0] === topic)?.[1] ?? topic;

  return (
    <>
      <BackLink onClick={onBack} label="Back to the plan" />
      <h1 style={{ fontFamily: fontSerif, fontSize: "24px", margin: "0 0 2px" }}>Deep dive — {topicLabel}</h1>
      <div style={{ fontSize: "12px", color: colors.inkSoft }}>Scoped search for this topic only{result?._fromCache && " · from cache"}</div>

      {busy && <p style={{ color: colors.inkSoft }}>Searching…</p>}

      {result && result.state === "SOURCE_UNAVAILABLE" && (
        <Card>
          <p style={{ color: "#a15c1e", fontSize: "13px" }}>{result.reason}</p>
        </Card>
      )}

      {result && result.state === "COMPUTED" && (
        <>
          {result.summary && (
            <Card>
              <p style={{ fontSize: "13px", margin: 0 }}>{result.summary}</p>
            </Card>
          )}
          {(result.sections ?? []).map((s: { heading: string; detail: string }, i: number) => (
            <Card key={i}>
              <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px" }}>{s.heading}</div>
              <div style={{ fontSize: "13px", color: colors.ink }}>{s.detail}</div>
            </Card>
          ))}
          <p style={{ fontSize: "11px", color: colors.inkSoft, fontStyle: "italic" }}>
            Based on a focused search for this specific topic — general guidance, not personalized advice.
          </p>
        </>
      )}

      {/* Addition 2: human assistance available on the deep-dive page too. */}
      <AskBox entryId={entryId} />
      <ConsultBox entryId={entryId} topic={topicLabel} />
    </>
  );
}

// =====================================================================
// Shared: ask-flow (two fixed questions → tailored plan) and human
// consult (interest-only, never "booking").
// =====================================================================

function AskFlowCard({ entryId }: { entryId: Id<"sideIncomeEntries"> }) {
  const submit = useAction(api.sideIncome.submitAskSession);
  const [open, setOpen] = useState(false);
  const [q1, setQ1] = useState("lowRiskSteady");
  const [q2, setQ2] = useState("under5Hours");
  const [depth, setDepth] = useState(1);
  const [planText, setPlanText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button style={{ ...primaryButtonStyle, width: "100%" }} onClick={() => setOpen(true)}>
        Still not sure? Ask a specific question
      </button>
    );
  }

  return (
    <Card>
      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>A couple of quick questions for your exact situation</div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <select style={f} value={q1} onChange={(e) => setQ1(e.target.value)}>
          <option value="lowRiskSteady">I prefer something low-risk and steady</option>
          <option value="higherRiskHigherUpside">I'm open to higher risk for higher upside</option>
        </select>
        <select style={f} value={q2} onChange={(e) => setQ2(e.target.value)}>
          <option value="under5Hours">Under 5 hours/week</option>
          <option value="5to15Hours">5–15 hours/week</option>
          <option value="15PlusHours">15+ hours/week</option>
        </select>
      </div>
      <button
        style={{ ...primaryButtonStyle, marginTop: "10px" }}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void submit({ sideIncomeEntryId: entryId, question1Answer: q1, question2Answer: q2, depthLevel: depth })
            .then((r) => setPlanText((r as { generatedPlanText: string }).generatedPlanText))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Generating…" : "Get my tailored plan"}
      </button>
      {planText && (
        <div style={{ marginTop: "10px" }}>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              textTransform: "uppercase",
              background: colors.creamDim,
              borderRadius: "10px",
              padding: "2px 8px",
              marginRight: "8px",
            }}
          >
            Depth {depth}
          </span>
          <button style={ghostButtonStyle} onClick={() => setDepth((d) => Math.min(6, d + 1))}>
            Go deeper
          </button>
          <p style={{ fontSize: "13px", marginTop: "8px" }}>{planText}</p>
        </div>
      )}
    </Card>
  );
}

function AskBox({ entryId }: { entryId: Id<"sideIncomeEntries"> }) {
  const submit = useAction(api.sideIncome.submitAskSession);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Card>
      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Still stuck on something?</div>
      <div style={{ display: "flex", gap: "8px" }}>
        <input style={f} value={text} onChange={(e) => setText(e.target.value)} placeholder="What's not making sense, or what's the problem?" />
        <button
          style={primaryButtonStyle}
          disabled={busy || text.trim() === ""}
          onClick={() => {
            setBusy(true);
            void submit({ sideIncomeEntryId: entryId, question1Answer: "lowRiskSteady", question2Answer: "under5Hours", depthLevel: 1 })
              .then((r) => setAnswer((r as { generatedPlanText: string }).generatedPlanText))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>
      {answer && <p style={{ fontSize: "13px", marginTop: "8px" }}>{answer}</p>}
    </Card>
  );
}

function ConsultBox({ entryId, topic }: { entryId: Id<"sideIncomeEntries">; topic: string }) {
  const request = useMutation(api.sideIncome.requestHumanConsult);
  const [sent, setSent] = useState(false);

  return (
    <div
      style={{
        border: `1px dashed ${colors.sageGreen}`,
        borderRadius: radius,
        padding: "14px 16px",
        background: colors.creamDim,
      }}
    >
      <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px" }}>Want a real person's opinion?</div>
      <button style={ghostButtonStyle} disabled={sent} onClick={() => void request({ entryId, topic }).then(() => setSent(true))}>
        {sent ? "Interest logged ✓" : "Request interest in a consultation"}
      </button>
      <div style={{ fontSize: "11px", color: colors.inkSoft, marginTop: "6px" }}>
        This logs your interest only — it does not book or schedule an expert.
      </div>
    </div>
  );
}
