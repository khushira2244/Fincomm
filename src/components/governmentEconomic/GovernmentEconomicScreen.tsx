import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { Card, CollapsibleSection, ghostButtonStyle, inputStyle, primaryButtonStyle } from "../goalPlanning/kit";

// =====================================================================
// Government, Economic & Livelihood Intelligence. Structurally
// different from every other service's frontend: this is mostly a
// PUSH system (a daily cron watches real sources and emails the
// household when something material changes) — the screen here is the
// light PULL layer on top: profile setup + findings feed + finding
// detail. Every number/finding rendered comes straight off the real
// backend in convex/governmentEconomic.ts; nothing here recomputes or
// re-decides severity.
// =====================================================================

const AMBER = "#8A6D1F";
const SIGNIFICANT_RED = "#A13D3D";
const dayMonth = (ts: number) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const f: React.CSSProperties = { ...inputStyle, width: "100%", boxSizing: "border-box" };

const AFFECTS_LABEL: Record<string, string> = {
  loanDebt: "Loan & Debt Resilience",
  sideIncome: "Side-Income & Business Planning",
  financialFoundation: "Financial Foundation",
  goalPlanning: "Goal & Situation Planning",
};

export function GovernmentEconomicScreen() {
  const [selectedFindingId, setSelectedFindingId] = useState<Id<"economicFindings"> | null>(null);

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: fontSerif, fontSize: "26px", margin: "0 0 4px" }}>Government, Economic &amp; Livelihood Intelligence</h1>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft, marginBottom: "6px" }}>
            Will the government&rsquo;s new IT sector investment affect hiring in my industry?
          </div>
          <div style={{ fontSize: "13px", color: colors.inkSoft }}>
            We watch for real changes that could affect plans you already have elsewhere in FinComp.
          </div>
        </div>
        {selectedFindingId ? (
          <FindingDetail findingId={selectedFindingId} onBack={() => setSelectedFindingId(null)} />
        ) : (
          <MainScreen onOpenFinding={setSelectedFindingId} />
        )}
      </div>
    </main>
  );
}

// =====================================================================
// Main screen — Job / Business tabs, each with a profile card + findings feed.
// =====================================================================

function MainScreen({ onOpenFinding }: { onOpenFinding: (id: Id<"economicFindings">) => void }) {
  const [track, setTrack] = useState<"job" | "business">("job");

  return (
    <>
      <div style={{ display: "flex", gap: "20px", borderBottom: `1px solid ${colors.creamDim}` }}>
        {(["job", "business"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            style={{
              fontFamily: fontSans,
              fontSize: "14px",
              fontWeight: 600,
              background: "none",
              border: "none",
              borderBottom: track === t ? `2px solid ${colors.deepGreen}` : "2px solid transparent",
              color: track === t ? colors.deepGreen : colors.inkSoft,
              padding: "0 0 10px",
              cursor: "pointer",
            }}
          >
            {t === "job" ? "Job" : "Business"}
          </button>
        ))}
      </div>

      {track === "job" ? <JobTrackPanel onOpenFinding={onOpenFinding} /> : <BusinessTrackPanel onOpenFinding={onOpenFinding} />}
    </>
  );
}

// =====================================================================
// Job track
// =====================================================================

function JobTrackPanel({ onOpenFinding }: { onOpenFinding: (id: Id<"economicFindings">) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles = useQuery(api.governmentEconomic.listLivelihoodProfiles, {}) as any[] | undefined;
  const jobProfile = profiles?.find((p) => p.track === "job") ?? null;
  const prefill = useQuery(api.governmentEconomic.getJobPrefillCandidate, {});
  const save = useAction(api.governmentEconomic.saveLivelihoodProfileAndCheck);

  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = text ?? jobProfile?.freeTextDescription ?? (jobProfile === null && prefill ? prefill.freeTextDescription : "") ?? "";
  const showPrefillNotice = jobProfile === null && prefill !== null && prefill !== undefined && text === null;

  const submit = () => {
    setBusy(true);
    setError(null);
    void save({
      track: "job",
      freeTextDescription: draft,
      source: showPrefillNotice ? "prefilledFromIncomeSource" : "userProvided",
    })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Card>
        <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>Tell us about your work</div>
        <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
          Just describe it in your own words — we&rsquo;ll figure out what to watch for.
        </div>
        {showPrefillNotice && (
          <div style={{ background: "#EDE6D3", borderRadius: radius, padding: "10px 12px", fontSize: "12.5px", color: colors.ink, marginBottom: "10px" }}>
            We noticed your income source &ldquo;{prefill!.freeTextDescription.split(",")[0] || "income"}&rdquo; may describe your work — pre-filled below. Edit if this isn&rsquo;t quite right.
          </div>
        )}
        {jobProfile && jobProfile.missingFields.length > 0 && (
          <MissingFieldsNotice fields={jobProfile.missingFields} />
        )}
        <textarea
          style={{ ...f, minHeight: "70px", resize: "vertical", fontFamily: fontSans }}
          value={draft}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Software Engineer, IT Services, Hyderabad"
        />
        <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
          <button style={primaryButtonStyle} disabled={busy || draft.trim() === ""} onClick={submit}>
            {busy ? "Checking…" : "Save & check for signals"}
          </button>
          {error && <span style={{ fontSize: "12px", color: "#a13d3d" }}>{error}</span>}
        </div>
      </Card>

      <FindingsFeed track="job" label="For your role" onOpenFinding={onOpenFinding} />
    </>
  );
}

// =====================================================================
// Business track — one card + feed per active/graduated business.
// =====================================================================

function BusinessTrackPanel({ onOpenFinding }: { onOpenFinding: (id: Id<"economicFindings">) => void }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles = useQuery(api.governmentEconomic.listLivelihoodProfiles, {}) as any[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = useQuery(api.governmentEconomic.getBusinessPrefillCandidates, {}) as any[] | undefined;
  const businessProfiles = profiles?.filter((p) => p.track === "business") ?? [];

  if (profiles === undefined || candidates === undefined) {
    return <Card><div style={{ fontSize: "12px", color: colors.inkSoft }}>loading…</div></Card>;
  }

  if (businessProfiles.length === 0 && candidates.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: "13px", margin: 0 }}>
          No active business yet. Once a Side-Income &amp; Business Planning entry becomes &ldquo;active&rdquo;, it&rsquo;ll show up here to monitor.
        </p>
      </Card>
    );
  }

  return (
    <>
      {businessProfiles.map((p) => (
        <BusinessCard key={p._id} profile={p} onOpenFinding={onOpenFinding} />
      ))}
      {candidates.map((c) => (
        <BusinessCard key={c.sideIncomeEntryId} candidate={c} onOpenFinding={onOpenFinding} />
      ))}
    </>
  );
}

function BusinessCard({
  profile,
  candidate,
  onOpenFinding,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile?: any;
  candidate?: { sideIncomeEntryId: Id<"sideIncomeEntries">; freeTextDescription: string; status: string };
  onOpenFinding: (id: Id<"economicFindings">) => void;
}) {
  const save = useAction(api.governmentEconomic.saveLivelihoodProfileAndCheck);
  const entryId: Id<"sideIncomeEntries"> = profile?.sideIncomeEntryId ?? candidate!.sideIncomeEntryId;
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = text ?? profile?.freeTextDescription ?? "";

  const submit = () => {
    setBusy(true);
    setError(null);
    void save({
      track: "business",
      freeTextDescription: draft,
      source: profile ? "userProvided" : "prefilledFromSideIncome",
      sideIncomeEntryId: entryId,
    })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <Card>
        <div style={{ fontFamily: fontSerif, fontSize: "16px", marginBottom: "2px" }}>Your business</div>
        <div style={{ fontSize: "12px", color: colors.inkSoft, marginBottom: "10px" }}>
          We pulled what we could from Side-Income &amp; Business Planning — fill in anything missing below.
        </div>
        {candidate && (
          <div style={{ background: "#EDE6D3", borderRadius: radius, padding: "10px 12px", fontSize: "12.5px", color: colors.ink, marginBottom: "10px" }}>
            Found: &ldquo;{candidate.freeTextDescription || "your business"}&rdquo; — {candidate.status}, from Side-Income &amp; Business Planning.
          </div>
        )}
        {profile && profile.missingFields.length > 0 && <MissingFieldsNotice fields={profile.missingFields} />}
        <textarea
          style={{ ...f, minHeight: "70px", resize: "vertical", fontFamily: fontSans }}
          value={draft}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Freelance Consulting, roughly ₹18,000/month, based in Hyderabad"
        />
        <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
          <button style={primaryButtonStyle} disabled={busy || draft.trim() === ""} onClick={submit}>
            {busy ? "Checking…" : "Save & check for signals"}
          </button>
          {error && <span style={{ fontSize: "12px", color: "#a13d3d" }}>{error}</span>}
        </div>
      </Card>
      <FindingsFeed track="business" entryId={entryId} label="For your business" onOpenFinding={onOpenFinding} />
    </>
  );
}

function MISSING_FIELD_LABEL(key: string): string {
  const labels: Record<string, string> = {
    occupation: "your occupation",
    sector: "your industry/sector",
    state: "your state",
    businessType: "your business type",
    approxIncome: "your approximate monthly business income",
  };
  return labels[key] ?? key;
}

function MissingFieldsNotice({ fields }: { fields: string[] }) {
  return (
    <div style={{ background: "#F5EBD8", border: `1px dashed ${AMBER}`, borderRadius: radius, padding: "10px 12px", fontSize: "12.5px", color: AMBER, marginBottom: "10px" }}>
      Missing: we don&rsquo;t have {fields.map(MISSING_FIELD_LABEL).join(", ")} tracked yet — this helps us match relevant scheme/rate signals.
    </div>
  );
}

// =====================================================================
// Findings feed — real rows from listEconomicFindings, filtered client-
// side by track (and, for a specific business, by affectsEntityId).
// =====================================================================

function FindingsFeed({
  track,
  entryId,
  label,
  onOpenFinding,
}: {
  track: "job" | "business";
  entryId?: Id<"sideIncomeEntries">;
  label: string;
  onOpenFinding: (id: Id<"economicFindings">) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = useQuery(api.governmentEconomic.listEconomicFindings, {}) as any[] | undefined;
  if (all === undefined) return null;
  // A finding with no affectsEntityId (e.g. interestRate, which is
  // household/track-wide, not tied to one business) still belongs on
  // this business's card — only exclude a finding that names A
  // DIFFERENT entry.
  const findings = all.filter((f) => f.track === track && (entryId === undefined || f.affectsEntityId === undefined || f.affectsEntityId === entryId));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: "4px" }}>
        <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft }}>{label}</span>
        <span style={{ fontSize: "11px", color: colors.inkSoft }}>{findings.length} finding{findings.length === 1 ? "" : "s"}</span>
      </div>
      {findings.length === 0 ? (
        <Card>
          <p style={{ fontSize: "13px", color: colors.inkSoft, margin: 0 }}>Nothing to report yet — checked signals are watched daily and this fills in as real changes happen.</p>
          <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: `1px solid ${colors.creamDim}` }}>
            <div style={{ fontFamily: fontSerif, fontSize: "14px", marginBottom: "6px" }}>What we watch for:</div>
            <ul style={{ fontSize: "13px", color: colors.inkSoft, margin: "0 0 10px", paddingLeft: "18px" }}>
              <li>Interest rate changes that could affect your loans</li>
              <li>Sector or job-market signals relevant to your role</li>
              <li>Economic shifts that could affect your goals</li>
            </ul>
            <p style={{ fontSize: "13px", color: colors.inkSoft, margin: 0 }}>
              If something significant changes, we&rsquo;ll email you directly — you don&rsquo;t need to check back here constantly.
            </p>
          </div>
        </Card>
      ) : (
        findings.map((finding) => <FindingCard key={finding._id} finding={finding} onOpen={() => onOpenFinding(finding._id)} />)
      )}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FindingCard({ finding, onOpen }: { finding: any; onOpen: () => void }) {
  const tone = finding.severity === "significant" ? SIGNIFICANT_RED : AMBER;
  return (
    <div onClick={onOpen} style={{ background: "#ffffff", border: `1px solid ${colors.creamDim}`, borderRadius: radius, padding: "14px 16px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: "12px" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: "14px" }}>{finding.narration.headline}</div>
        <div style={{ fontSize: "12.5px", color: colors.inkSoft, marginTop: "2px" }}>{finding.narration.plainLanguage}</div>
        {finding.affectsService && (
          <div style={{ fontSize: "11.5px", color: colors.deepGreen, marginTop: "6px" }}>
            Affects: {AFFECTS_LABEL[finding.affectsService] ?? finding.affectsService} →
          </div>
        )}
      </div>
      <span
        style={{
          alignSelf: "flex-start",
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: tone,
          background: finding.severity === "significant" ? "#F3DEDE" : "#F5EBD8",
          borderRadius: "10px",
          padding: "3px 10px",
          whiteSpace: "nowrap",
        }}
      >
        {finding.severity}
      </span>
    </div>
  );
}

// =====================================================================
// Finding detail
// =====================================================================

const FINDING_TYPE_LABEL: Record<string, string> = {
  interestRate: "Interest rate signal",
  sectorRisk: "Sector risk signal",
  scheme: "Scheme signal",
  regulatory: "Regulatory signal",
};

function FindingDetail({ findingId, onBack }: { findingId: Id<"economicFindings">; onBack: () => void }) {
  const finding = useQuery(api.governmentEconomic.getEconomicFinding, { findingId });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obligations = useQuery(api.loanDebt.listObligations, {}) as any[] | undefined;

  if (finding === undefined) return <div style={{ fontSize: "12px", color: colors.inkSoft }}>loading…</div>;
  if (finding === null) {
    return (
      <Card>
        <p style={{ fontSize: "13px", margin: 0 }}>This finding isn&rsquo;t available.</p>
      </Card>
    );
  }

  const tone = finding.severity === "significant" ? SIGNIFICANT_RED : AMBER;
  const floatingLoan = obligations?.find((o) => o.rateType === "floating");
  const rateMatch = typeof finding.body === "string" ? finding.body.match(/(\d{1,2}(?:\.\d{1,2})?)% to (\d{1,2}(?:\.\d{1,2})?)%/) : null;

  return (
    <>
      <span onClick={onBack} style={{ fontSize: "13px", color: colors.deepGreen, cursor: "pointer", textDecoration: "underline" }}>
        ← Back to findings
      </span>
      <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft }}>
        {finding.track === "job" ? "Job track" : "Business track"} · {FINDING_TYPE_LABEL[finding.findingType] ?? finding.findingType}
      </div>

      <div style={{ background: tone, color: colors.cream, borderRadius: radius, padding: "16px 20px" }}>
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
          {finding.severity}
        </span>
        <div style={{ fontSize: "15px", lineHeight: 1.4 }}>{finding.narration.headline}</div>
      </div>

      {finding.affectsService && (
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px" }}>This affects {AFFECTS_LABEL[finding.affectsService] ?? finding.affectsService}</span>
          </div>
        </Card>
      )}

      {finding.findingType === "interestRate" && rateMatch && (
        <div style={{ display: "flex", gap: "10px" }}>
          <Card>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft, marginBottom: "4px" }}>Reference rate</div>
            <div style={{ fontFamily: fontSerif, fontSize: "18px", color: colors.deepGreen }}>{rateMatch[1]}% → {rateMatch[2]}%</div>
          </Card>
          {finding.track === "job" && floatingLoan && (
            <Card>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.inkSoft, marginBottom: "4px" }}>{floatingLoan.label}</div>
              <div style={{ fontFamily: fontSerif, fontSize: "18px", color: colors.deepGreen }}>Floating</div>
            </Card>
          )}
        </div>
      )}

      <DetailsAndDeepDive finding={finding} />

      {finding.narration.caveats.length > 0 && (
        <div style={{ background: "#F5EBD8", border: `1px dashed ${AMBER}`, borderRadius: radius, padding: "12px 14px", fontSize: "12.5px", color: colors.ink }}>
          <strong style={{ color: AMBER }}>What this is, and isn&rsquo;t</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: "16px" }}>
            {(finding.narration.caveats as string[]).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <ActionRow finding={finding} />

      <p style={{ fontSize: "11px", color: colors.inkSoft, margin: 0 }}>Found {dayMonth(finding.generatedAt)}.</p>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DetailsAndDeepDive({ finding }: { finding: any }) {
  const generateDeepDive = useAction(api.governmentEconomic.generateFindingDeepDive);
  const [deepDive, setDeepDive] = useState<{ summary: string; sections: { heading: string; detail: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <CollapsibleSection title="What changed" defaultOpen>
      <p style={{ fontSize: "13px", margin: "0 0 10px" }}>{finding.narration.plainLanguage}</p>
      {Array.isArray(finding.steps) && finding.steps.length > 0 && (
        <ul style={{ fontSize: "13px", margin: "0 0 10px", paddingLeft: "18px" }}>
          {(finding.steps as string[]).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      {!deepDive && (
        <button
          style={ghostButtonStyle}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void generateDeepDive({ findingId: finding._id })
              .then((r) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const d = r as any;
                if (d.state === "SOURCE_UNAVAILABLE") setError(d.reason);
                else setDeepDive({ summary: d.summary, sections: d.sections });
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Searching…" : "Deep dive into this"}
        </button>
      )}
      {error && <p style={{ fontSize: "12px", color: "#a13d3d" }}>{error}</p>}
      {deepDive && (
        <div style={{ marginTop: "10px", borderTop: `1px solid ${colors.creamDim}`, paddingTop: "10px" }}>
          <p style={{ fontSize: "13px", fontStyle: "italic", margin: "0 0 8px" }}>{deepDive.summary}</p>
          {deepDive.sections.map((s, i) => (
            <div key={i} style={{ marginBottom: "8px" }}>
              <div style={{ fontWeight: 700, fontSize: "13px" }}>{s.heading}</div>
              <div style={{ fontSize: "12.5px", color: colors.inkSoft }}>{s.detail}</div>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ActionRow({ finding }: { finding: any }) {
  const send = useAction(api.governmentEconomic.emailFindingSummary);
  const [emailBusy, setEmailBusy] = useState(false);
  const [outboundId, setOutboundId] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const status = useQuery(api.governmentEconomic.emailFindingSendStatus, outboundId ? { outboundId } : "skip");

  const requestConsult = useMutation(api.humanConsult.requestHumanConsult);
  const [askLogged, setAskLogged] = useState(false);
  const [consultLogged, setConsultLogged] = useState(false);
  const [consultBusy, setConsultBusy] = useState<"ask" | "consult" | null>(null);

  const logTicket = (kind: "ask" | "consult") => {
    setConsultBusy(kind);
    void requestConsult({
      sourceService: "governmentEconomic",
      sourceEntityId: finding._id,
      topic: kind === "ask" ? `Question about: ${finding.narration.headline}` : finding.narration.headline,
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
            void send({ findingId: finding._id })
              .then((r) => {
                if (r.status === "sent" && r.outboundId) setOutboundId(r.outboundId);
                else setEmailError(r.detail);
              })
              .catch((err: Error) => setEmailError(err.message))
              .finally(() => setEmailBusy(false));
          }}
        >
          {emailBusy ? "Sending…" : "Email me this finding"}
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
