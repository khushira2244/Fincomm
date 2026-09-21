// Government, Economic & Livelihood Intelligence (Service #9).
//
// STRUCTURALLY DIFFERENT from every prior service: every prior service is
// PULL (user asks, system answers). This one is fundamentally PUSH — a
// daily cron monitors real sources and proactively alerts the household
// via AgentMail when something material genuinely changes — with a light
// PULL layer (profile setup + findings feed + deep dives) on top.
//
// Two tracks:
//  - "job": the household's salaried work. Watches reference-rate moves
//    (only when a floating-rate loan exists — Loan & Debt data) and
//    sector/job-market risk signals for the household's own sector.
//  - "business": ACTIVE or graduated Side-Income entries ONLY, never
//    "exploring"/"selected". Watches business-relevant rate moves,
//    genuine government-scheme matches, and regulatory/compliance shifts.
//
// AI BOUNDARY (strict): OpenAI extracts structured fields (occupation,
// sector, state, business type, approx income) from free text — this is
// EXTRACTION, same as Document Intelligence, never a calculation.
// OpenAI NEVER: decides whether a finding is significant (deterministic
// per-findingType threshold below), decides whether a scheme match is
// genuine (deterministic keyword match against REAL Firecrawl search
// result titles/descriptions — no AI involved in that decision at all),
// or invents any rate/economic number. Narration-only past extraction,
// generated fresh every time a finding is created — same discipline as
// every other service.
//
// SECURITY: every action/query touching a household's own data calls
// requireMembership (or an internalQuery that does) first. The cron/
// monitoring path runs with no caller identity by design (it's system-
// triggered background work against householdIds already established by
// an authenticated save), so its internal functions look up the
// household directly — never take a client-supplied identity shortcut.

import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMembership } from "./access";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { AgentMail } from "@agentmail/convex";

declare const process: { env: Record<string, string | undefined> };

const firecrawl = new FirecrawlClient(components.firecrawl);
const agentmailSender = new AgentMail(components.agentmail);

const rupees = (minor: number) => `₹${Math.round(minor).toLocaleString("en-IN")}`;

async function chatJson(system: string, user: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ConvexError("OPENAI_API_KEY is not set on this deployment.");
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!resp.ok) throw new ConvexError(`OpenAI request failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  const data = (await resp.json()) as { choices: { message: { content: string } }[] };
  try {
    return JSON.parse(data.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const vNarration = v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) });

// =====================================================================
// Pre-fill (keyword-based, deterministic — see functions below).
// =====================================================================

// Generic income-table words that carry no occupation signal on their
// own. A label like "Salary" or "Monthly income" strips down to nothing
// and is correctly rejected as a pre-fill candidate; a label like
// "Software Engineer salary" strips down to "Software Engineer" and is
// accepted. Deterministic substring/regex only — no AI involved in
// deciding whether a label is descriptive enough to pre-fill.
const GENERIC_INCOME_WORDS = ["salary", "income", "pay", "wage", "wages", "earnings", "stipend", "paycheck", "monthly", "annual"];

function isDescriptiveLabel(label: string): boolean {
  let stripped = label;
  for (const w of GENERIC_INCOME_WORDS) stripped = stripped.replace(new RegExp(`\\b${w}\\b`, "gi"), "");
  return stripped.replace(/\s+/g, " ").trim().length >= 3;
}

export const getJobPrefillCandidate = query({
  args: {},
  returns: v.union(v.null(), v.object({ freeTextDescription: v.string(), incomeSourceId: v.id("incomeSources") })),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const sources = await ctx.db.query("incomeSources").withIndex("by_household_active", (q) => q.eq("householdId", membership.householdId).eq("activeTo", undefined)).collect();
    const candidate = sources.find((s) => isDescriptiveLabel(s.label));
    if (!candidate) return null;
    return { freeTextDescription: candidate.label, incomeSourceId: candidate._id };
  },
});

// Business track always auto-pulls from active/graduated Side-Income
// entries — no keyword gate, per spec. Only entries that don't already
// have a livelihoodProfiles row are returned as "needs setup" candidates.
export const getBusinessPrefillCandidates = query({
  args: {},
  returns: v.array(v.object({ sideIncomeEntryId: v.id("sideIncomeEntries"), freeTextDescription: v.string(), status: v.string() })),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const entries = await ctx.db
      .query("sideIncomeEntries")
      .withIndex("by_household_kind", (q) => q.eq("householdId", membership.householdId).eq("kind", "business"))
      .collect();
    const active = entries.filter((e) => e.status === "active" || e.status === "graduated");
    const existingProfiles = await ctx.db.query("livelihoodProfiles").withIndex("by_household_track", (q) => q.eq("householdId", membership.householdId).eq("track", "business")).collect();
    const profiledEntryIds = new Set(existingProfiles.map((p) => p.sideIncomeEntryId));
    return active
      .filter((e) => !profiledEntryIds.has(e._id))
      .map((e) => ({ sideIncomeEntryId: e._id, freeTextDescription: e.ideaDescription ?? "", status: e.status }));
  },
});

// =====================================================================
// Save & check for signals — the one write path for livelihoodProfiles.
// =====================================================================

export const listLivelihoodProfiles = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    return await ctx.db.query("livelihoodProfiles").withIndex("by_household", (q) => q.eq("householdId", membership.householdId)).collect();
  },
});

export const requireOwnedProfileInternal = internalQuery({
  args: { profileId: v.id("livelihoodProfiles") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const profile = await ctx.db.get("livelihoodProfiles", args.profileId);
    if (profile === null || profile.householdId !== membership.householdId) throw new ConvexError("Livelihood profile not found.");
    return profile;
  },
});

function computeMissingFields(track: "job" | "business", fields: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (track === "job") {
    if (!fields.interpretedOccupation) missing.push("occupation");
    if (!fields.interpretedSector) missing.push("sector");
    if (!fields.interpretedState) missing.push("state");
  } else {
    if (!fields.interpretedBusinessType) missing.push("businessType");
    if (fields.interpretedApproxIncomeMinorUnits === undefined || fields.interpretedApproxIncomeMinorUnits === null) missing.push("approxIncome");
  }
  return missing;
}

// BUG FOUND DURING VERIFICATION: Convex drops an explicit `undefined`
// value for an optional field across the action -> internalMutation
// call boundary (the key is simply absent by the time this handler's
// `args` is constructed), so spreading `...args` into `db.patch` left
// STALE interpreted* values in place when a re-save's extraction found
// nothing new (e.g. re-describing a job vaguely after previously giving
// a detailed description). Fixed by accepting an explicit `null` for
// "extraction found nothing" (null survives the call boundary, unlike
// undefined) and converting it to `undefined` right before the
// in-process `db.patch`/`db.insert` call, which DOES correctly clear an
// optional field when it happens inside the same function body.
export const upsertLivelihoodProfile = internalMutation({
  args: {
    householdId: v.id("households"),
    track: v.union(v.literal("job"), v.literal("business")),
    freeTextDescription: v.string(),
    source: v.union(v.literal("userProvided"), v.literal("prefilledFromIncomeSource"), v.literal("prefilledFromSideIncome")),
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
    interpretedOccupation: v.optional(v.union(v.string(), v.null())),
    interpretedSector: v.optional(v.union(v.string(), v.null())),
    interpretedState: v.optional(v.union(v.string(), v.null())),
    interpretedBusinessType: v.optional(v.union(v.string(), v.null())),
    interpretedApproxIncomeMinorUnits: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.id("livelihoodProfiles"),
  handler: async (ctx, args) => {
    const missingFields = computeMissingFields(args.track, args);
    const now = Date.now();
    const toWrite = {
      householdId: args.householdId,
      track: args.track,
      freeTextDescription: args.freeTextDescription,
      source: args.source,
      sideIncomeEntryId: args.sideIncomeEntryId,
      interpretedOccupation: args.interpretedOccupation === null ? undefined : args.interpretedOccupation,
      interpretedSector: args.interpretedSector === null ? undefined : args.interpretedSector,
      interpretedState: args.interpretedState === null ? undefined : args.interpretedState,
      interpretedBusinessType: args.interpretedBusinessType === null ? undefined : args.interpretedBusinessType,
      interpretedApproxIncomeMinorUnits: args.interpretedApproxIncomeMinorUnits === null ? undefined : args.interpretedApproxIncomeMinorUnits,
    };
    // Job track: one row per household. Business track: one row per
    // sideIncomeEntryId (a household can run more than one active
    // business, each monitored independently).
    const existing =
      args.track === "job"
        ? await ctx.db.query("livelihoodProfiles").withIndex("by_household_track", (q) => q.eq("householdId", args.householdId).eq("track", "job")).first()
        : args.sideIncomeEntryId
          ? await ctx.db.query("livelihoodProfiles").withIndex("by_sideIncomeEntry", (q) => q.eq("sideIncomeEntryId", args.sideIncomeEntryId)).first()
          : null;
    if (existing) {
      await ctx.db.patch(existing._id, { ...toWrite, missingFields, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("livelihoodProfiles", { ...toWrite, missingFields, createdAt: now, updatedAt: now });
  },
});

export const saveLivelihoodProfileAndCheck = action({
  args: {
    track: v.union(v.literal("job"), v.literal("business")),
    freeTextDescription: v.string(),
    source: v.union(v.literal("userProvided"), v.literal("prefilledFromIncomeSource"), v.literal("prefilledFromSideIncome")),
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const membership = await ctx.runMutation(api.governmentEconomic.ensureAccess, {});
    const householdId = membership as Id<"households">;

    if (args.track === "business") {
      if (!args.sideIncomeEntryId) throw new ConvexError("Business-track profiles require sideIncomeEntryId.");
      const entry = (await ctx.runQuery(internal.governmentEconomic.getOwnedSideIncomeEntryInternal, {
        householdId,
        sideIncomeEntryId: args.sideIncomeEntryId,
      })) as Doc<"sideIncomeEntries"> | null;
      if (entry === null) throw new ConvexError("Side-income entry not found.");
      if (entry.kind !== "business") throw new ConvexError("Only business-kind Side-Income entries can have a business-track livelihood profile.");
      if (entry.status !== "active" && entry.status !== "graduated") {
        throw new ConvexError(`This business is still "${entry.status}" — Government, Economic & Livelihood Intelligence only monitors ACTIVE or graduated businesses, never "exploring"/"selected".`);
      }
    }

    const extracted =
      args.track === "job"
        ? await extractJobFields(args.freeTextDescription)
        : await extractBusinessFields(args.freeTextDescription);

    const profileId = (await ctx.runMutation(internal.governmentEconomic.upsertLivelihoodProfile, {
      householdId,
      track: args.track,
      freeTextDescription: args.freeTextDescription,
      source: args.source,
      sideIncomeEntryId: args.sideIncomeEntryId,
      ...extracted,
    })) as Id<"livelihoodProfiles">;

    // Immediate initial assessment — a real, honest answer to "what's
    // happening right now", not just a silent monitoring baseline. Gated
    // on whether a baseline already exists for this EXACT sector/business
    // type (not on whether the profile row itself is new), so a vague
    // first save with no sector yet still gets a real assessment once the
    // sector becomes known on a later save, and a genuine sector/business
    // -type change later gets its own fresh assessment too. Runs BEFORE
    // the ongoing monitoring check below so it establishes the real
    // baseline that check compares against, instead of racing it.
    if (args.track === "job") {
      const sector = (extracted as { interpretedSector: string | null }).interpretedSector;
      if (sector) {
        const existingBaseline = await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, {
          householdId,
          track: "job",
          signalType: `sectorRisk:${sector.toLowerCase()}`,
        });
        if (existingBaseline === null) await checkInitialJobAssessment(ctx, householdId, sector);
      }
    } else if (args.sideIncomeEntryId) {
      const businessType = (extracted as { interpretedBusinessType: string | null }).interpretedBusinessType;
      if (businessType) {
        const existingBaseline = await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, {
          householdId,
          track: "business",
          signalType: `scheme:${args.sideIncomeEntryId}:${businessType.toLowerCase()}`,
        });
        if (existingBaseline === null) await checkInitialBusinessAssessment(ctx, householdId, args.sideIncomeEntryId, businessType);
      }
    }

    // Immediately trigger a fresh ongoing-monitoring check too — don't
    // wait for the next cron tick. Runs the whole household's monitoring
    // (all tracks/profiles), not just this one save — cheap (a handful of
    // scrapes/searches) and simpler than threading a track-scoped path
    // through the same orchestrator the cron already uses; each signal
    // only ever creates a finding on genuine CHANGE from a baseline, so
    // running it right after the initial assessment above (which just set
    // that baseline) correctly produces no duplicate finding.
    await ctx.runAction(internal.governmentEconomic.runHouseholdMonitoringCheckInternal, { householdId });

    const profile = await ctx.runQuery(internal.governmentEconomic.getProfileByIdInternal, { profileId });
    return profile;
  },
});

export const ensureAccess = mutation({
  args: {},
  returns: v.id("households"),
  handler: async (ctx) => (await requireMembership(ctx)).householdId,
});

export const getOwnedSideIncomeEntryInternal = internalQuery({
  args: { householdId: v.id("households"), sideIncomeEntryId: v.id("sideIncomeEntries") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("sideIncomeEntries", args.sideIncomeEntryId);
    if (entry === null || entry.householdId !== args.householdId) return null;
    return entry;
  },
});

export const getProfileByIdInternal = internalQuery({
  args: { profileId: v.id("livelihoodProfiles") },
  returns: v.any(),
  handler: async (ctx, args) => await ctx.db.get("livelihoodProfiles", args.profileId),
});

// Return `null` (not `undefined`) for "extraction found nothing" — null
// is the value that actually survives the action -> internalMutation
// call boundary intact, so upsertLivelihoodProfile can tell "genuinely
// absent, please clear this field" apart from "key not sent at all".
async function extractJobFields(freeText: string): Promise<{ interpretedOccupation: string | null; interpretedSector: string | null; interpretedState: string | null }> {
  const system = `You extract structured fields from a household member's free-text description of their salaried job. This is EXTRACTION ONLY — pull out what the text actually says, never infer or invent a fact the text doesn't support. Return ONLY JSON: { "occupation": string | null, "sector": string | null, "state": string | null }. "occupation" is a short job title/role (e.g. "Software Engineer", "School Teacher"). "sector" is the industry (e.g. "IT Services", "Education", "Manufacturing"). "state" is an Indian state/UT if named. Use null for anything the text genuinely doesn't say — never guess a plausible-sounding default.`;
  const parsed = await chatJson(system, JSON.stringify({ freeText }));
  return {
    interpretedOccupation: typeof parsed.occupation === "string" && parsed.occupation.trim() ? parsed.occupation.trim() : null,
    interpretedSector: typeof parsed.sector === "string" && parsed.sector.trim() ? parsed.sector.trim() : null,
    interpretedState: typeof parsed.state === "string" && parsed.state.trim() ? parsed.state.trim() : null,
  };
}

async function extractBusinessFields(freeText: string): Promise<{ interpretedBusinessType: string | null; interpretedApproxIncomeMinorUnits: number | null }> {
  const system = `You extract structured fields from a household's free-text description of their small business. This is EXTRACTION ONLY — pull out what the text actually says, never infer or invent a fact the text doesn't support. Return ONLY JSON: { "businessType": string | null, "approxIncomeMinorUnits": number | null }. "businessType" is a short category (e.g. "Tailoring", "Tiffin Service", "Freelance Web Development"). "approxIncomeMinorUnits" is a monthly rupee figure in paise (rupees × 100) ONLY if the text states one — otherwise null. Never invent a figure the text doesn't contain.`;
  const parsed = await chatJson(system, JSON.stringify({ freeText }));
  return {
    interpretedBusinessType: typeof parsed.businessType === "string" && parsed.businessType.trim() ? parsed.businessType.trim() : null,
    interpretedApproxIncomeMinorUnits: typeof parsed.approxIncomeMinorUnits === "number" ? Math.round(parsed.approxIncomeMinorUnits) : null,
  };
}

// =====================================================================
// Findings feed — plain reads of already-created rows.
// =====================================================================

export const listEconomicFindings = query({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const rows = await ctx.db.query("economicFindings").withIndex("by_household_generatedAt", (q) => q.eq("householdId", membership.householdId)).collect();
    return rows.sort((a, b) => b.generatedAt - a.generatedAt);
  },
});

export const getEconomicFinding = query({
  args: { findingId: v.id("economicFindings") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const row = await ctx.db.get("economicFindings", args.findingId);
    if (row === null || row.householdId !== membership.householdId) return null;
    return row;
  },
});

// =====================================================================
// Monitoring / comparison — the core PUSH logic. Every signal is scraped
// or searched for real, compared against economicMonitoringState, and
// only creates a economicFindings row when the value has GENUINELY,
// MATERIALLY changed — never on every check.
// =====================================================================

const RATE_SOURCE_URL = "https://www.rbi.org.in/";
const RATE_SOURCE_LABEL = "Reserve Bank of India — official Policy Repo Rate";
// Distinct sourceRegistry key from Loan & Debt's own use of this same
// real URL, so a cache-hit there never collides with this file's own
// snapshot shape — same "#"-suffix technique used for every prior
// same-URL reuse this session.
const RATE_SOURCE_KEY = RATE_SOURCE_URL + "#government-economic-interest-rate";

const RATE_SIGNIFICANT_BPS = 25; // >=0.25 percentage points

function parseBenchmarkRateBps(markdown: string): number | null {
  const text = markdown.replace(/\s+/g, " ");
  const patterns = [
    /policy repo rate\s*\|?\s*:?\s*(?:<br>)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i,
    /(?:policy )?repo rate[^.|]{0,40}?(\d{1,2}(?:\.\d{1,2})?)\s*(?:percent|%)/i,
    /benchmark interest rate[^.]*?(\d{1,2}(?:\.\d{1,2})?)\s*(?:percent|%)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const pct = Number(m[1]);
      if (pct >= 0 && pct <= 25) return Math.round(pct * 100);
    }
  }
  return null;
}

const SECTOR_HARD_KEYWORDS = ["layoff", "layoffs", "job cuts", "hiring freeze", "workforce reduction", "mass exit"];
const SECTOR_CAUTIONARY_KEYWORDS = ["slowdown", "growth moderating", "hiring slows", "subdued demand", "cautious outlook"];

function classifySectorSignal(text: string): "hard" | "cautionary" | "none" {
  const lower = text.toLowerCase();
  if (SECTOR_HARD_KEYWORDS.some((k) => lower.includes(k))) return "hard";
  if (SECTOR_CAUTIONARY_KEYWORDS.some((k) => lower.includes(k))) return "cautionary";
  return "none";
}

const REGULATORY_HARD_KEYWORDS = ["mandatory", "penalty", "penalties", "deadline", "compliance requirement", "must register", "non-compliance"];

function hasRegulatorySignal(text: string): { present: boolean; hard: boolean } {
  const lower = text.toLowerCase();
  const hard = REGULATORY_HARD_KEYWORDS.some((k) => lower.includes(k));
  const present = hard || /regulat|compliance|circular|notification/i.test(lower);
  return { present, hard };
}

function cheapHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

export const getMonitoringStateInternal = internalQuery({
  args: { householdId: v.id("households"), track: v.union(v.literal("job"), v.literal("business")), signalType: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) =>
    await ctx.db
      .query("economicMonitoringState")
      .withIndex("by_household_track_signal", (q) => q.eq("householdId", args.householdId).eq("track", args.track).eq("signalType", args.signalType))
      .first(),
});

export const saveMonitoringStateInternal = internalMutation({
  args: { householdId: v.id("households"), track: v.union(v.literal("job"), v.literal("business")), signalType: v.string(), lastKnownValue: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("economicMonitoringState")
      .withIndex("by_household_track_signal", (q) => q.eq("householdId", args.householdId).eq("track", args.track).eq("signalType", args.signalType))
      .first();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { lastKnownValue: args.lastKnownValue, lastCheckedAt: now });
    else await ctx.db.insert("economicMonitoringState", { ...args, lastCheckedAt: now });
    return null;
  },
});

export const ensureSourceInternal = internalMutation({
  args: { url: v.string(), label: v.string(), authorityLevel: v.string() },
  returns: v.id("sourceRegistry"),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("sourceRegistry").withIndex("by_url", (q) => q.eq("url", args.url)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("sourceRegistry", { url: args.url, label: args.label, isAllowlisted: true, authorityLevel: args.authorityLevel });
  },
});

export const saveSnapshotInternal = internalMutation({
  args: { sourceId: v.id("sourceRegistry"), contentSummary: v.string() },
  returns: v.id("sourceSnapshots"),
  handler: async (ctx, args) => await ctx.db.insert("sourceSnapshots", { sourceRegistryId: args.sourceId, fetchedAt: Date.now(), contentSummary: args.contentSummary.slice(0, 2000) }),
});

export const createFindingInternal = internalMutation({
  args: {
    householdId: v.id("households"),
    track: v.union(v.literal("job"), v.literal("business")),
    findingType: v.union(v.literal("interestRate"), v.literal("sectorRisk"), v.literal("scheme"), v.literal("regulatory"), v.literal("initialAssessment")),
    severity: v.union(v.literal("notable"), v.literal("significant")),
    title: v.string(),
    headline: v.string(),
    body: v.optional(v.string()),
    steps: v.optional(v.array(v.string())),
    affectsService: v.string(),
    affectsEntityId: v.optional(v.string()),
    narration: vNarration,
    sourceSnapshotId: v.id("sourceSnapshots"),
  },
  returns: v.id("economicFindings"),
  handler: async (ctx, args) => await ctx.db.insert("economicFindings", { ...args, generatedAt: Date.now(), emailSent: false }),
});

async function narrateFinding(
  findingType: string,
  severity: "notable" | "significant",
  headline: string,
  detail: string,
): Promise<{ headline: string; plainLanguage: string; caveats: string[] }> {
  const system = `You put an ALREADY-DECIDED economic/livelihood finding into plain language for a household. You are given the finding type, its deterministic severity ("notable" or "significant" — already decided, never yours to change), a factual headline, and supporting detail. Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }. NEVER invent a rate, figure, date, deadline, or scheme name not in the given detail. NEVER tell the household what to do ("switch your loan", "apply now") — describe what changed and why it might matter, and point them to verify with the actual source or a professional. NEVER state a specific date, year, deadline, or cutoff not explicitly present in the given detail.`;
  const parsed = await chatJson(system, JSON.stringify({ findingType, severity, headline, detail }));
  return {
    headline: typeof parsed.headline === "string" && parsed.headline ? parsed.headline : headline,
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : detail,
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c): c is string => typeof c === "string") : [],
  };
}

async function narrateInitialAssessment(
  track: "job" | "business",
  subject: string,
  snippets: string,
  level: "hard" | "cautionary" | "none",
): Promise<{ headline: string; plainLanguage: string; caveats: string[] }> {
  const system = `You are writing a household's FIRST, one-time "here's the current picture" assessment for ${
    track === "job" ? `their sector ("${subject}")` : `their business type ("${subject}")`
  } — generated the moment they set this up, not a "something changed" alert. You are given real, recent web search snippets and a deterministic signal level ("hard" | "cautionary" | "none" — already decided by separate keyword logic from the snippets, never yours to change). Return ONLY JSON: { "headline": string, "plainLanguage": string, "caveats": string[] }. If the level is "none" or the snippets are empty, say plainly that no major signals were found right now — do not invent risk, opportunity, or investment activity that isn't in the snippets. NEVER invent a rate, figure, date, deadline, scheme name, or investment amount not present in the given snippets. NEVER tell the household what to do — describe the current picture and point them to verify with the actual source or a professional if it matters to a decision. NEVER state a specific date, year, deadline, or cutoff not explicitly present in the snippets.`;
  const parsed = await chatJson(system, JSON.stringify({ track, subject, level, snippets: snippets || "No search results found." }));
  return {
    headline: typeof parsed.headline === "string" && parsed.headline ? parsed.headline : `Current picture for ${subject}`,
    plainLanguage: typeof parsed.plainLanguage === "string" ? parsed.plainLanguage : (snippets ? "See details below." : "No major signals found right now."),
    caveats: Array.isArray(parsed.caveats) ? parsed.caveats.filter((c): c is string => typeof c === "string") : [],
  };
}

// ---- Initial assessment (job track): a real, immediate answer to "what's
// happening in my sector right now" — generated once, the first time a
// household has a usable sector for this track, not on every save. Uses
// the SAME query keywords (and the same deterministic classifySectorSignal)
// as the ongoing sector-risk monitor below, plus "government investment" to
// also cover that angle in the one search — deliberately kept close to that
// query's wording (not a separately-phrased one) so the baseline this seeds
// stays consistent with what that check will independently re-derive
// moments later in the same save, rather than the two searches surfacing
// different content because they were phrased differently. Then narrates
// directly against the question this screen poses (a "current picture",
// not a "this changed" alert), and seeds the ongoing monitor's baseline
// with the level it found — so the next daily check compares against this
// real observation instead of treating a later read as the first-ever
// baseline and firing a false "increase".
async function checkInitialJobAssessment(
  ctx: { runQuery: Function; runMutation: Function },
  householdId: Id<"households">,
  sector: string,
): Promise<Id<"economicFindings"> | null> {
  const queryText = `${sector} sector India government investment hiring layoffs job market outlook ${new Date().getFullYear()}`;
  let items: Array<{ title?: string; description?: string; url?: string }> = [];
  try {
    const results = await firecrawl.search(ctx as never, queryText, { limit: 5, sources: ["web"] });
    items = (results.web ?? []) as never;
  } catch {
    return null; // couldn't retrieve real signals — say nothing rather than invent
  }
  const snippets = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""}`).join("\n").slice(0, 3000);
  const level = classifySectorSignal(snippets);

  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, {
    url: `firecrawl-search:${queryText}`,
    label: `Web search: ${sector} sector outlook`,
    authorityLevel: "web-search-aggregate",
  })) as Id<"sourceRegistry">;
  const snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, {
    sourceId,
    contentSummary: snippets || "No results found.",
  })) as Id<"sourceSnapshots">;

  // Seed the ongoing sector-risk monitor's baseline with this real,
  // just-observed level — see comment above the function.
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, {
    householdId,
    track: "job",
    signalType: `sectorRisk:${sector.toLowerCase()}`,
    lastKnownValue: level,
  });

  const severity: "notable" | "significant" = level === "hard" ? "significant" : "notable";
  const headline =
    items.length === 0
      ? `No major signals found right now for the ${sector} sector`
      : level === "hard"
        ? `Active hiring/workforce signals found right now in the ${sector} sector`
        : level === "cautionary"
          ? `Some cautionary signals found right now in the ${sector} sector`
          : `No major hiring or investment risk signals found right now in the ${sector} sector`;
  const narration = await narrateInitialAssessment("job", sector, snippets, level);
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track: "job",
    findingType: "initialAssessment",
    severity,
    title: `Current picture: ${sector}`,
    headline,
    body: snippets || "No relevant recent coverage found for this sector.",
    affectsService: "financialFoundation",
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// ---- Initial assessment (business track): a real, immediate answer to
// "what government schemes exist for this business type right now" —
// generated once per business, the first time it gets a usable business
// type. Reuses checkSchemeSignal's exact search pattern, then narrates
// directly, and seeds the ongoing scheme monitor's baseline with the
// scheme names seen here so tomorrow's check only fires on a genuinely
// NEW scheme, not one already surfaced in this initial assessment.
async function checkInitialBusinessAssessment(
  ctx: { runQuery: Function; runMutation: Function },
  householdId: Id<"households">,
  entryId: Id<"sideIncomeEntries">,
  businessType: string,
): Promise<Id<"economicFindings"> | null> {
  const queryText = `government scheme subsidy loan for ${businessType} small business India ${new Date().getFullYear()}`;
  let items: Array<{ title?: string; description?: string; url?: string }> = [];
  try {
    const results = await firecrawl.search(ctx as never, queryText, { limit: 6, sources: ["web"] });
    items = (results.web ?? []) as never;
  } catch {
    return null;
  }
  const names = items.map((it) => (it.title ?? "").trim()).filter((t) => t.length > 0);
  const snippets = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""}`).join("\n").slice(0, 3000);

  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, {
    url: `firecrawl-search:${queryText}`,
    label: `Web search: government schemes for ${businessType}`,
    authorityLevel: "web-search-aggregate",
  })) as Id<"sourceRegistry">;
  const snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, {
    sourceId,
    contentSummary: snippets || "No results found.",
  })) as Id<"sourceSnapshots">;

  // Seed the ongoing scheme monitor's baseline — see comment above the function.
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, {
    householdId,
    track: "business",
    signalType: `scheme:${entryId}:${businessType.toLowerCase()}`,
    lastKnownValue: names.slice(0, 50),
  });

  const headline =
    names.length > 0
      ? `${names.length} possible government scheme${names.length === 1 ? "" : "s"} found right now for ${businessType}`
      : `No open government schemes found right now for ${businessType}`;
  const narration = await narrateInitialAssessment("business", businessType, snippets, names.length > 0 ? "cautionary" : "none");
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track: "business",
    findingType: "initialAssessment",
    severity: "notable",
    title: `Current picture: ${businessType}`,
    headline,
    steps: names.length > 0 ? [`Verify eligibility conditions directly on each scheme's own page before relying on this.`] : undefined,
    body: snippets || "No relevant scheme coverage found for this business type.",
    affectsService: "sideIncome",
    affectsEntityId: entryId,
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// ---- Interest rate signal (job: gated on a floating-rate loan; business: always for active businesses) ----

export const householdHasFloatingLoanInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const obligations = await ctx.db.query("obligations").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect();
    return obligations.some((o) => o.rateType === "floating");
  },
});

async function checkInterestRateSignal(ctx: { runQuery: Function; runMutation: Function }, householdId: Id<"households">, track: "job" | "business"): Promise<Id<"economicFindings"> | null> {
  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, { url: RATE_SOURCE_KEY, label: RATE_SOURCE_LABEL, authorityLevel: "official-central-bank" })) as Id<"sourceRegistry">;
  let rateBps: number | null;
  let snapshotId: Id<"sourceSnapshots">;
  try {
    const doc = await firecrawl.scrape(ctx as never, RATE_SOURCE_URL, { formats: ["markdown"] });
    const md = (doc.markdown ?? "") as string;
    rateBps = parseBenchmarkRateBps(md);
    snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, { sourceId, contentSummary: md.slice(0, 600) })) as Id<"sourceSnapshots">;
  } catch {
    return null; // unreachable source — say nothing, never invent a rate
  }
  if (rateBps === null) return null;

  const state = (await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, { householdId, track, signalType: "referenceRate" })) as Doc<"economicMonitoringState"> | null;
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, { householdId, track, signalType: "referenceRate", lastKnownValue: rateBps });
  if (state === null || typeof state.lastKnownValue !== "number") return null; // first observation — establishes baseline only, no finding

  const diffBps = Math.abs(rateBps - state.lastKnownValue);
  if (diffBps === 0) return null; // unchanged — never a duplicate finding
  const severity: "notable" | "significant" = diffBps >= RATE_SIGNIFICANT_BPS ? "significant" : "notable";
  const oldPct = (state.lastKnownValue / 100).toFixed(2);
  const newPct = (rateBps / 100).toFixed(2);
  const headline = `RBI's official reference rate moved from ${oldPct}% to ${newPct}%`;
  const narration = await narrateFinding("interestRate", severity, headline, `Reference rate change of ${(diffBps / 100).toFixed(2)} percentage points, relevant to ${track === "job" ? "this household's existing floating-rate loan" : "this household's active business"}.`);
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track,
    findingType: "interestRate",
    severity,
    title: "Reference rate change",
    headline,
    body: `RBI's official policy repo rate moved from ${oldPct}% to ${newPct}% (a change of ${(diffBps / 100).toFixed(2)} percentage points).`,
    affectsService: track === "job" ? "loanDebt" : "sideIncome",
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// ---- Sector risk signal (job track only, when interpretedSector is set) ----

async function checkSectorRiskSignal(ctx: { runQuery: Function; runMutation: Function }, householdId: Id<"households">, sector: string): Promise<Id<"economicFindings"> | null> {
  const queryText = `${sector} sector India hiring layoffs job market outlook ${new Date().getFullYear()}`;
  let items: Array<{ title?: string; description?: string; url?: string }> = [];
  try {
    const results = await firecrawl.search(ctx as never, queryText, { limit: 5, sources: ["web"] });
    items = (results.web ?? []) as never;
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  const snippets = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""}`).join("\n").slice(0, 3000);
  const level = classifySectorSignal(snippets);

  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, { url: `firecrawl-search:${queryText}`, label: `Web search: ${sector} sector outlook`, authorityLevel: "web-search-aggregate" })) as Id<"sourceRegistry">;
  const snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, { sourceId, contentSummary: snippets })) as Id<"sourceSnapshots">;

  const signalType = `sectorRisk:${sector.toLowerCase()}`;
  const state = (await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, { householdId, track: "job", signalType })) as Doc<"economicMonitoringState"> | null;
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, { householdId, track: "job", signalType, lastKnownValue: level });
  const rank: Record<string, number> = { none: 0, cautionary: 1, hard: 2 };
  const previousLevel = typeof state?.lastKnownValue === "string" ? state.lastKnownValue : "none";
  if (state === null) return null; // first observation only
  if (rank[level] <= rank[previousLevel]) return null; // only fires on an INCREASE in signal strength — never on stable or improving conditions
  const severity: "notable" | "significant" = level === "hard" ? "significant" : "notable";
  const headline = `${sector} sector risk signal ${level === "hard" ? "increased sharply" : "increased"} in recent reports`;
  const narration = await narrateFinding("sectorRisk", severity, headline, snippets.slice(0, 800));
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track: "job",
    findingType: "sectorRisk",
    severity,
    title: `${sector} sector risk`,
    headline,
    body: snippets.slice(0, 1200),
    affectsService: "financialFoundation",
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// ---- Scheme signal (business track only). Deterministic match — NO AI
// decides whether a scheme match is genuine. A Firecrawl search result's
// own title/description IS the real, structured evidence; "genuine" is a
// plain case-insensitive substring check against the household's own
// businessType, not a model judgment call. ----

async function checkSchemeSignal(ctx: { runQuery: Function; runMutation: Function }, householdId: Id<"households">, entryId: Id<"sideIncomeEntries">, businessType: string): Promise<Id<"economicFindings"> | null> {
  const queryText = `government scheme subsidy loan for ${businessType} small business India ${new Date().getFullYear()}`;
  let items: Array<{ title?: string; description?: string; url?: string }> = [];
  try {
    const results = await firecrawl.search(ctx as never, queryText, { limit: 6, sources: ["web"] });
    items = (results.web ?? []) as never;
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  const names = items.map((it) => (it.title ?? "").trim()).filter((t) => t.length > 0);
  if (names.length === 0) return null;

  const signalType = `scheme:${entryId}:${businessType.toLowerCase()}`;
  const state = (await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, { householdId, track: "business", signalType })) as Doc<"economicMonitoringState"> | null;
  const previouslySeen: string[] = Array.isArray(state?.lastKnownValue) ? (state!.lastKnownValue as string[]) : [];
  const previousSet = new Set(previouslySeen.map((n) => n.toLowerCase()));
  const newNames = names.filter((n) => !previousSet.has(n.toLowerCase()));
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, {
    householdId,
    track: "business",
    signalType,
    lastKnownValue: Array.from(new Set([...previouslySeen, ...names])).slice(0, 50),
  });
  if (state === null) return null; // first observation establishes the baseline only
  if (newNames.length === 0) return null; // nothing genuinely new — no duplicate finding

  const matchedItem = items.find((it) => newNames.includes((it.title ?? "").trim()));
  const businessTypeNamed = (matchedItem?.title ?? "").toLowerCase().includes(businessType.toLowerCase()) || (matchedItem?.description ?? "").toLowerCase().includes(businessType.toLowerCase());
  const severity: "notable" | "significant" = businessTypeNamed ? "significant" : "notable";
  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, { url: `firecrawl-search:${queryText}`, label: `Web search: government schemes for ${businessType}`, authorityLevel: "web-search-aggregate" })) as Id<"sourceRegistry">;
  const snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, { sourceId, contentSummary: newNames.join("\n") })) as Id<"sourceSnapshots">;
  const headline = `Possible new scheme match: ${matchedItem?.title ?? newNames[0]}`;
  const narration = await narrateFinding("scheme", severity, headline, `${matchedItem?.title ?? newNames[0]}: ${matchedItem?.description ?? ""}. Note: possibly eligible — verify these conditions with the scheme's own page, this is not confirmed eligibility.`);
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track: "business",
    findingType: "scheme",
    severity,
    title: "Possible government scheme match",
    headline,
    steps: [`Verify eligibility conditions directly on the scheme's own page before relying on this.`, `Source: ${matchedItem?.url ?? "see search results"}.`],
    affectsService: "sideIncome",
    affectsEntityId: entryId,
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// ---- Regulatory signal (business track only) ----

async function checkRegulatorySignal(ctx: { runQuery: Function; runMutation: Function }, householdId: Id<"households">, entryId: Id<"sideIncomeEntries">, businessType: string): Promise<Id<"economicFindings"> | null> {
  const queryText = `${businessType} compliance regulation changes India ${new Date().getFullYear()}`;
  let items: Array<{ title?: string; description?: string; url?: string }> = [];
  try {
    const results = await firecrawl.search(ctx as never, queryText, { limit: 5, sources: ["web"] });
    items = (results.web ?? []) as never;
  } catch {
    return null;
  }
  if (items.length === 0) return null;
  const snippets = items.map((it) => `${it.title ?? ""}: ${it.description ?? ""}`).join("\n").slice(0, 3000);
  const { present, hard } = hasRegulatorySignal(snippets);
  if (!present) return null;
  const contentHash = cheapHash(snippets);

  const signalType = `regulatory:${entryId}:${businessType.toLowerCase()}`;
  const state = (await ctx.runQuery(internal.governmentEconomic.getMonitoringStateInternal, { householdId, track: "business", signalType })) as Doc<"economicMonitoringState"> | null;
  await ctx.runMutation(internal.governmentEconomic.saveMonitoringStateInternal, { householdId, track: "business", signalType, lastKnownValue: contentHash });
  if (state === null) return null;
  if (state.lastKnownValue === contentHash) return null; // identical results — no duplicate finding

  const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, { url: `firecrawl-search:${queryText}`, label: `Web search: ${businessType} compliance`, authorityLevel: "web-search-aggregate" })) as Id<"sourceRegistry">;
  const snapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, { sourceId, contentSummary: snippets })) as Id<"sourceSnapshots">;
  const severity: "notable" | "significant" = hard ? "significant" : "notable";
  const headline = `New regulatory/compliance information found for ${businessType}`;
  const narration = await narrateFinding("regulatory", severity, headline, snippets.slice(0, 800));
  return (await ctx.runMutation(internal.governmentEconomic.createFindingInternal, {
    householdId,
    track: "business",
    findingType: "regulatory",
    severity,
    title: "Regulatory/compliance update",
    headline,
    body: snippets.slice(0, 1200),
    affectsService: "sideIncome",
    affectsEntityId: entryId,
    narration,
    sourceSnapshotId: snapshotId,
  })) as Id<"economicFindings">;
}

// =====================================================================
// Orchestrator — runs every configured signal for one household, then
// sends at most one batched AgentMail digest for whatever's newly
// significant and still unsent (the "one email per day" cap lives in
// sendBatchedFindingsEmailInternal, not here).
// =====================================================================

// Hackathon-scale bound — the sweep processes at most this many profiles
// per cron tick. A production version would paginate; not needed here.
const SWEEP_PROFILE_LIMIT = 1000;

export const listAllProfilesInternal = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async (ctx) => await ctx.db.query("livelihoodProfiles").take(SWEEP_PROFILE_LIMIT),
});

export const listHouseholdProfilesInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => await ctx.db.query("livelihoodProfiles").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).collect(),
});

export const runHouseholdMonitoringCheckInternal = internalAction({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const profiles = (await ctx.runQuery(internal.governmentEconomic.listHouseholdProfilesInternal, { householdId: args.householdId })) as Doc<"livelihoodProfiles">[];

    const jobProfile = profiles.find((p) => p.track === "job");
    if (jobProfile) {
      const hasFloatingLoan = (await ctx.runQuery(internal.governmentEconomic.householdHasFloatingLoanInternal, { householdId: args.householdId })) as boolean;
      if (hasFloatingLoan) await checkInterestRateSignal(ctx, args.householdId, "job");
      if (jobProfile.interpretedSector) await checkSectorRiskSignal(ctx, args.householdId, jobProfile.interpretedSector);
    }

    const businessProfiles = profiles.filter((p) => p.track === "business" && p.sideIncomeEntryId);
    for (const bp of businessProfiles) {
      // Re-verify the entry is STILL active at check time, not just when
      // the profile was created — a business that regresses to a
      // non-active status stops being monitored without deleting the row.
      const entry = (await ctx.runQuery(internal.governmentEconomic.getOwnedSideIncomeEntryInternal, { householdId: args.householdId, sideIncomeEntryId: bp.sideIncomeEntryId! })) as Doc<"sideIncomeEntries"> | null;
      if (!entry || (entry.status !== "active" && entry.status !== "graduated")) continue;
      await checkInterestRateSignal(ctx, args.householdId, "business");
      if (bp.interpretedBusinessType) {
        await checkSchemeSignal(ctx, args.householdId, bp.sideIncomeEntryId!, bp.interpretedBusinessType);
        await checkRegulatorySignal(ctx, args.householdId, bp.sideIncomeEntryId!, bp.interpretedBusinessType);
      }
    }

    await ctx.runAction(internal.governmentEconomic.sendBatchedFindingsEmailInternal, { householdId: args.householdId });
    return null;
  },
});

// =====================================================================
// Proactive AgentMail alert — one batched digest per household, capped
// at one send per rolling 24h. Only "significant" findings trigger an
// email; "notable" ones stay pull-only in the findings feed (documented
// decision: avoid over-alerting on changes that don't cross the line
// that actually matters).
// =====================================================================

const EMAIL_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const getHouseholdEmailInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const membership = await ctx.db.query("memberships").withIndex("by_household", (q) => q.eq("householdId", args.householdId)).first();
    if (!membership) return null;
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

export const getPendingSignificantFindingsInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("economicFindings").withIndex("by_household_generatedAt", (q) => q.eq("householdId", args.householdId)).collect();
    return rows.filter((r) => r.severity === "significant" && !r.emailSent);
  },
});

export const getLastEmailSentAtInternal = internalQuery({
  args: { householdId: v.id("households") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("economicFindings").withIndex("by_household_generatedAt", (q) => q.eq("householdId", args.householdId)).collect();
    const sent = rows.filter((r) => r.emailSent).sort((a, b) => b.generatedAt - a.generatedAt)[0];
    return sent ? sent.generatedAt : null;
  },
});

export const markFindingsEmailedInternal = internalMutation({
  args: { findingIds: v.array(v.id("economicFindings")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const id of args.findingIds) await ctx.db.patch(id, { emailSent: true });
    return null;
  },
});

function composeDigestEmailText(findings: Doc<"economicFindings">[]): string {
  const lines = [
    findings.length === 1 ? "One thing changed that's worth your attention:" : `${findings.length} things changed that are worth your attention:`,
    "",
  ];
  for (const f of findings) {
    lines.push(`• ${f.narration.headline}`);
    lines.push(`  ${f.narration.plainLanguage}`);
    if (f.narration.caveats.length > 0) for (const c of f.narration.caveats) lines.push(`  Note: ${c}`);
    lines.push("");
  }
  lines.push("Open FinComp's Government, Economic & Livelihood Intelligence page to see full detail and sources.");
  lines.push("— Sent from FinComp, automatically, because something genuinely changed. This is not filing or financial advice.");
  return lines.join("\n");
}

export const sendBatchedFindingsEmailInternal = internalAction({
  args: { householdId: v.id("households") },
  returns: v.object({ sent: v.boolean(), reason: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const pending = (await ctx.runQuery(internal.governmentEconomic.getPendingSignificantFindingsInternal, { householdId: args.householdId })) as Doc<"economicFindings">[];
    if (pending.length === 0) return { sent: false, reason: "No pending significant findings." };

    const lastSentAt = (await ctx.runQuery(internal.governmentEconomic.getLastEmailSentAtInternal, { householdId: args.householdId })) as number | null;
    if (lastSentAt !== null && Date.now() - lastSentAt < EMAIL_CAP_WINDOW_MS) {
      return { sent: false, reason: "Capped — an alert email was already sent for this household within the last 24h. Pending findings remain unsent and will be included in the next eligible digest." };
    }

    const toEmail = (await ctx.runQuery(internal.governmentEconomic.getHouseholdEmailInternal, { householdId: args.householdId })) as string | null;
    if (!toEmail) return { sent: false, reason: "No email address is on file for this household." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) return { sent: false, reason: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };

    const subject = pending.length === 1 ? `FinComp — ${pending[0].narration.headline}` : `FinComp — ${pending.length} economic/livelihood updates`;
    const text = composeDigestEmailText(pending);
    try {
      const outboundId = await agentmailSender.sendMessage(ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0], inboxId, { to: toEmail, subject, text });
      await ctx.runMutation(internal.governmentEconomic.markFindingsEmailedInternal, { findingIds: pending.map((p) => p._id) });
      return { sent: true, reason: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return { sent: false, reason: err instanceof Error ? err.message : String(err) };
    }
  },
});

// =====================================================================
// Cron entrypoint — staggers each household's check across the sweep
// window instead of firing every scrape simultaneously. See convex/crons.ts.
// =====================================================================

const STAGGER_INTERVAL_MS = 15_000; // 15s apart — spreads Firecrawl load across the sweep

export const sweepAllHouseholds = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const profiles = (await ctx.runQuery(internal.governmentEconomic.listAllProfilesInternal, {})) as Doc<"livelihoodProfiles">[];
    const householdIds = Array.from(new Set(profiles.map((p) => p.householdId)));
    for (let i = 0; i < householdIds.length; i++) {
      await ctx.scheduler.runAfter(i * STAGGER_INTERVAL_MS, internal.governmentEconomic.runHouseholdMonitoringCheckInternal, { householdId: householdIds[i] });
    }
    return null;
  },
});

// =====================================================================
// Deep dive — same scoped-per-finding cached pattern as Side-Income's
// deep dives. One Firecrawl search + one OpenAI reasoning pass, specific
// to that one finding, cached per household + finding (never shared
// across households).
// =====================================================================

export const requireOwnedFindingInternal = internalQuery({
  args: { findingId: v.id("economicFindings") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const finding = await ctx.db.get("economicFindings", args.findingId);
    if (finding === null || finding.householdId !== membership.householdId) throw new ConvexError("Finding not found.");
    return finding;
  },
});

export const findCachedFindingDeepDiveInternal = internalQuery({
  args: { householdId: v.id("households"), findingId: v.id("economicFindings") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) =>
    await ctx.db
      .query("economicFindingDeepDives")
      .withIndex("by_household_finding", (q) => q.eq("householdId", args.householdId).eq("findingId", args.findingId))
      .first(),
});

export const saveFindingDeepDiveInternal = internalMutation({
  args: { householdId: v.id("households"), findingId: v.id("economicFindings"), result: v.any(), sourceSnapshotIds: v.array(v.id("sourceSnapshots")) },
  returns: v.id("economicFindingDeepDives"),
  handler: async (ctx, args) => await ctx.db.insert("economicFindingDeepDives", { ...args, fetchedAt: Date.now(), createdAt: Date.now() }),
});

export const generateFindingDeepDive = action({
  args: { findingId: v.id("economicFindings") },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const finding = (await ctx.runQuery(internal.governmentEconomic.requireOwnedFindingInternal, { findingId: args.findingId })) as Doc<"economicFindings">;
    const householdId = finding.householdId;

    const cached = await ctx.runQuery(internal.governmentEconomic.findCachedFindingDeepDiveInternal, { householdId, findingId: args.findingId });
    if (cached) return { ...(cached as { result: Record<string, unknown> }).result, _fromCache: true };

    const queryText = `${finding.headline} — what this means, practical next steps India`;
    let searchSummary = "";
    let sourceSnapshotId: Id<"sourceSnapshots"> | null = null;
    try {
      const results = await firecrawl.search(ctx, queryText, { limit: 6, sources: ["web"] });
      const items = (results.web ?? []).slice(0, 6);
      if (items.length === 0) return { state: "SOURCE_UNAVAILABLE", reason: "The search returned no results for this finding." };
      searchSummary = items.map((it) => `${("title" in it && it.title) || ""}: ${("description" in it && it.description) || ""} (${("url" in it && it.url) || ""})`).join("\n").slice(0, 4500);
      const sourceId = (await ctx.runMutation(internal.governmentEconomic.ensureSourceInternal, { url: `firecrawl-search:${queryText}`, label: `Web search: ${finding.headline}`, authorityLevel: "web-search-aggregate" })) as Id<"sourceRegistry">;
      sourceSnapshotId = (await ctx.runMutation(internal.governmentEconomic.saveSnapshotInternal, { sourceId, contentSummary: searchSummary })) as Id<"sourceSnapshots">;
    } catch (err) {
      return { state: "SOURCE_UNAVAILABLE", reason: `The search couldn't be completed (${err instanceof Error ? err.message : String(err)}).` };
    }

    const system = `You reason over REAL web search snippets to write a substantive, practical briefing that goes deeper on one specific economic/livelihood finding already shown to a household. Return ONLY JSON: { "summary": string, "sections": [{ "heading": string, "detail": string }] }. Produce 2-4 sections grounded ONLY in the snippets given — never invent a rate, figure, scheme name, or deadline the snippets don't contain. Never give filing/legal instructions — describe context and point to verifying with the real source or a professional.`;
    const parsed = await chatJson(system, JSON.stringify({ finding: { headline: finding.headline, findingType: finding.findingType, body: finding.body, steps: finding.steps }, searchSnippets: searchSummary }));
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
    const sections = rawSections
      .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
      .map((s) => ({ heading: typeof s.heading === "string" ? s.heading : "", detail: typeof s.detail === "string" ? s.detail : "" }))
      .filter((s) => s.heading !== "" && s.detail !== "");
    const result = { state: "COMPUTED", summary: typeof parsed.summary === "string" ? parsed.summary : "", sections };
    await ctx.runMutation(internal.governmentEconomic.saveFindingDeepDiveInternal, {
      householdId,
      findingId: args.findingId,
      result,
      sourceSnapshotIds: sourceSnapshotId ? [sourceSnapshotId] : [],
    });
    return result;
  },
});

// =====================================================================
// "Email me this finding" — user-triggered, same existing AgentMail
// pattern as every other service (Tax Planning's emailTaxSummary /
// emailSendStatus). Distinct from sendBatchedFindingsEmailInternal
// above, which is the PROACTIVE, system-triggered digest — this one is
// a single finding, sent because the household asked for it right now.
// =====================================================================

export const getCallerEmailInternal = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const user = await ctx.db.get("users", membership.userId);
    return user?.email ?? null;
  },
});

function composeFindingEmailText(finding: Doc<"economicFindings">): string {
  const lines = [finding.narration.headline, "", finding.narration.plainLanguage, ""];
  if (finding.narration.caveats.length > 0) {
    lines.push("Please keep in mind:");
    for (const c of finding.narration.caveats) lines.push(`  • ${c}`);
    lines.push("");
  }
  lines.push(`This is a real, sourced signal — not a certainty about what your specific lender/scheme/employer will do. Confirm details with the actual source.`);
  lines.push("— Sent from FinComp's Government, Economic & Livelihood Intelligence, at your request.");
  return lines.join("\n");
}

export const emailFindingSummary = action({
  args: { findingId: v.id("economicFindings") },
  returns: v.object({ status: v.union(v.literal("sent"), v.literal("failed")), detail: v.string(), outboundId: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const finding = (await ctx.runQuery(internal.governmentEconomic.requireOwnedFindingInternal, { findingId: args.findingId })) as Doc<"economicFindings">;
    const toEmail = (await ctx.runQuery(internal.governmentEconomic.getCallerEmailInternal, {})) as string | null;
    if (!toEmail) return { status: "failed" as const, detail: "No email address is on file for this account." };
    const inboxId = process.env.AGENTMAIL_SENDER_INBOX_ID;
    if (!inboxId) return { status: "failed" as const, detail: "AGENTMAIL_SENDER_INBOX_ID is not set on this deployment." };
    const text = composeFindingEmailText(finding);
    try {
      const outboundId = await agentmailSender.sendMessage(ctx as unknown as Parameters<typeof agentmailSender.sendMessage>[0], inboxId, { to: toEmail, subject: `FinComp — ${finding.narration.headline}`, text });
      return { status: "sent" as const, detail: `Queued for delivery to ${toEmail}.`, outboundId };
    } catch (err) {
      return { status: "failed" as const, detail: err instanceof Error ? err.message : String(err) };
    }
  },
});

export const emailFindingSendStatus = query({
  args: { outboundId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await agentmailSender.status(ctx, args.outboundId as any);
  },
});

// Human consult ("Want a real person's opinion?" / "Still stuck? Ask a
// question" — this service has no dedicated Q&A backend, so both
// buttons log a real ticket via the same generalized mechanism every
// other service uses, distinguished only by topic text) reuses the
// generic convex/humanConsult.ts mutation — called from the frontend
// with sourceService: "governmentEconomic", sourceEntityId: <finding id>.

void rupees; // reserved for frontend-facing formatting reuse; kept here to match every other service's helper placement
