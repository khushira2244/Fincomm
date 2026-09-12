// Plan analysis for Goal & Situation Planning. Deterministic checks run
// first (reusing Financial Foundation's runway query as the numeric
// base — never modifying or duplicating it); OpenAI only narrates the
// already-computed results. Results are cached in `planAnalyses` keyed
// on the exact confirmed-timeline set + household stateRevision.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMembership } from "./access";

// `process.env` is available in Convex's default action runtime for
// reading deployment env vars; the ambient Node types just don't resolve
// for this project's convex/tsconfig.json (see documentIntelligence.ts).
declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------
// Input gathering (one query so the action reads a consistent snapshot)
// ---------------------------------------------------------------------

export const gatherInputs = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;
    const household = await ctx.db.get("households", householdId);
    if (household === null) {
      throw new ConvexError("Household not found.");
    }

    const timelines = (
      await ctx.db
        .query("timelines")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect()
    ).sort((a, b) => a.order - b.order);
    const confirmed = timelines.filter((t) => t.confirmed === true);
    const confirmedIds = new Set(confirmed.map((t) => t._id));
    const confirmedIdsSorted = confirmed.map((t) => t._id).sort();

    const [income, expenses, obligations, assets] = await Promise.all([
      ctx.db
        .query("incomeSources")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("expenses")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("obligations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const [familySupport, familyObligations, loans, goals, situations] = await Promise.all([
      ctx.db
        .query("timelineFamilySupport")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("familyObligations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("timelineLoans")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("goals")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
      ctx.db
        .query("situations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .collect(),
    ]);

    const inConfirmed = <T extends { timelineId?: Id<"timelines"> }>(rows: T[]) =>
      rows.filter((r) => r.timelineId !== undefined && confirmedIds.has(r.timelineId));

    return {
      householdId,
      stateRevision: household.stateRevision,
      confirmedTimelines: confirmed.map((t) => ({ _id: t._id, label: t.label, yearsLabel: t.yearsLabel })),
      confirmedIdsSorted,
      ff: { income, expenses, obligations, assets },
      tl: {
        familySupport: inConfirmed(familySupport),
        familyObligations: inConfirmed(familyObligations),
        loans: inConfirmed(loans),
        goals: inConfirmed(goals),
        situations: inConfirmed(situations),
      },
    };
  },
});

// ---------------------------------------------------------------------
// Cache lookup + save
// ---------------------------------------------------------------------

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

export const findCached = internalQuery({
  args: { timelineIds: v.array(v.id("timelines")), stateRevision: v.number() },
  returns: v.union(v.null(), v.id("planAnalyses")),
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const rows = await ctx.db
      .query("planAnalyses")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    const match = rows
      .filter(
        (r) =>
          sameSet([...r.timelineIds].sort(), [...args.timelineIds].sort()) &&
          r.inputStateRevision === args.stateRevision,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return match ? match._id : null;
  },
});

export const saveAnalysis = internalMutation({
  args: {
    householdId: v.id("households"),
    timelineIds: v.array(v.id("timelines")),
    inputStateRevision: v.number(),
    result: v.any(),
  },
  returns: v.id("planAnalyses"),
  handler: async (ctx, args) => {
    const sorted = [...args.timelineIds].sort();
    // Drop older analyses for this exact set — only the latest is useful.
    const existing = await ctx.db
      .query("planAnalyses")
      .withIndex("by_household", (q) => q.eq("householdId", args.householdId))
      .collect();
    for (const row of existing) {
      if (sameSet([...row.timelineIds].sort(), sorted)) {
        await ctx.db.delete("planAnalyses", row._id);
      }
    }
    return await ctx.db.insert("planAnalyses", {
      householdId: args.householdId,
      timelineIds: sorted,
      inputStateRevision: args.inputStateRevision,
      result: args.result,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------
// generateAnalysis — deterministic checks + OpenAI narration + cache
// ---------------------------------------------------------------------

type RunwayResult = {
  status: "depleting" | "not_depleting";
  runwayMonths: number | null;
  monthlyNetGapMinorUnits: number;
  unrestrictedLiquidSavingsMinorUnits: number;
  essentialMonthlyExpensesMinorUnits: number;
  totalEmiMinorUnits: number;
  dependableMonthlyIncomeMinorUnits: number;
};

export const generateAnalysis = action({
  args: {},
  returns: v.object({ cached: v.boolean() }),
  handler: async (ctx): Promise<{ cached: boolean }> => {
    const now = Date.now();
    const runway = (await ctx.runQuery(api.runway.calculateRunway, { now })) as RunwayResult;
    const inputs = (await ctx.runQuery(internal.planAnalysis.gatherInputs, {})) as GatherInputs;

    if (inputs.confirmedIdsSorted.length === 0) {
      throw new ConvexError("Confirm at least one timeline before generating an analysis.");
    }

    const cachedId = await ctx.runQuery(internal.planAnalysis.findCached, {
      timelineIds: inputs.confirmedIdsSorted,
      stateRevision: inputs.stateRevision,
    });
    if (cachedId !== null) {
      return { cached: true };
    }

    const deterministic = computeDeterministic(runway, inputs);
    const narrated = await narrateAnalysis(deterministic);
    const result = {
      verdict: narrated.verdict,
      categories: deterministic.categories.map((c) => {
        const n = narrated.categories.find((x) => x.key === c.key);
        return {
          key: c.key,
          title: c.title,
          dot: c.dot,
          timelineRefs: c.timelineRefs,
          summary: n?.summary ?? "",
          detail: n?.detail ?? "",
        };
      }),
      whatIfChips: narrated.whatIfChips,
      deterministic,
    };

    await ctx.runMutation(internal.planAnalysis.saveAnalysis, {
      householdId: inputs.householdId,
      timelineIds: inputs.confirmedIdsSorted,
      inputStateRevision: inputs.stateRevision,
      result,
    });
    return { cached: false };
  },
});

// ---------------------------------------------------------------------
// getLatestAnalysis — for the "Your plan, at a glance" screen
// ---------------------------------------------------------------------

export const getLatestAnalysis = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      result: v.any(),
      createdAt: v.number(),
      isCurrent: v.boolean(),
      confirmedTimelineCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const membership = await requireMembership(ctx);
    const household = await ctx.db.get("households", membership.householdId);
    if (household === null) return null;

    const timelines = await ctx.db
      .query("timelines")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    const confirmedIds = timelines
      .filter((t) => t.confirmed === true)
      .map((t) => t._id)
      .sort();
    if (confirmedIds.length === 0) return null;

    const rows = await ctx.db
      .query("planAnalyses")
      .withIndex("by_household", (q) => q.eq("householdId", membership.householdId))
      .collect();
    const latest = rows
      .filter((r) => sameSet([...r.timelineIds].sort(), confirmedIds))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!latest) return null;

    return {
      result: latest.result,
      createdAt: latest.createdAt,
      isCurrent: latest.inputStateRevision === household.stateRevision,
      confirmedTimelineCount: confirmedIds.length,
    };
  },
});

// ---------------------------------------------------------------------
// answerWhatIf — keyword scenario detection + arithmetic on the runway
// breakdown + OpenAI narration (numbers are never invented by the model)
// ---------------------------------------------------------------------

export const answerWhatIf = action({
  args: { question: v.string() },
  returns: v.object({
    verdict: v.string(),
    stats: v.array(v.object({ label: v.string(), value: v.string() })),
    explanation: v.string(),
    calculationDetail: v.string(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const runway = (await ctx.runQuery(api.runway.calculateRunway, { now })) as RunwayResult;
    const scenario = detectScenario(args.question);
    const computed = applyScenario(scenario, runway);
    const narrated = await narrateWhatIf(args.question, computed);
    return {
      verdict: narrated.verdict,
      stats: computed.stats,
      explanation: narrated.explanation,
      calculationDetail: computed.detail,
    };
  },
});

// ---------------------------------------------------------------------
// Deterministic computation
// ---------------------------------------------------------------------

type GatherInputs = {
  householdId: Id<"households">;
  stateRevision: number;
  confirmedTimelines: { _id: Id<"timelines">; label: string; yearsLabel: string }[];
  confirmedIdsSorted: Id<"timelines">[];
  ff: {
    income: { _id: string }[];
    expenses: { _id: string }[];
    obligations: { _id: string }[];
    assets: { _id: string }[];
  };
  tl: {
    familySupport: { _id: string; timelineId: Id<"timelines">; label: string; monthlyCostMinorUnits: number }[];
    familyObligations: {
      _id: string;
      timelineId: Id<"timelines">;
      label: string;
      costPerYearMinorUnits: number;
      forHowManyYears: number;
    }[];
    loans: { _id: string; timelineId: Id<"timelines">; label: string; emiMinorUnits: number; outstandingBalanceMinorUnits: number }[];
    goals: {
      _id: string;
      timelineId: Id<"timelines">;
      description: string;
      horizon?: "shortTerm" | "longTerm";
      targetAmountMinorUnits?: number;
    }[];
    situations: { _id: string; timelineId: Id<"timelines">; description: string; situationCategory?: string }[];
  };
};

type CategoryComputed = {
  key: string;
  title: string;
  dot: "green" | "amber";
  timelineRefs: { timelineId: string; label: string }[];
  facts: Record<string, unknown>;
};

function computeDeterministic(runway: RunwayResult, inputs: GatherInputs) {
  const labelById = new Map(inputs.confirmedTimelines.map((t) => [t._id, t.label]));
  const refs = (rows: { timelineId: Id<"timelines"> }[]) => {
    const seen = new Set<string>();
    const out: { timelineId: string; label: string }[] = [];
    for (const r of rows) {
      if (seen.has(r.timelineId)) continue;
      seen.add(r.timelineId);
      out.push({ timelineId: r.timelineId, label: labelById.get(r.timelineId) ?? "a timeline" });
    }
    return out;
  };

  const surplus = -runway.monthlyNetGapMinorUnits; // income − essential − EMI
  const categories: CategoryComputed[] = [];

  const fs = inputs.tl.familySupport;
  const fo = inputs.tl.familyObligations;
  if (fs.length + fo.length > 0) {
    const monthlySupport = fs.reduce((s, x) => s + x.monthlyCostMinorUnits, 0);
    const monthlyEquivOblig = Math.round(fo.reduce((s, x) => s + x.costPerYearMinorUnits / 12, 0));
    const combined = monthlySupport + monthlyEquivOblig;
    const fits = combined <= Math.max(surplus, 0);
    categories.push({
      key: "familyDependents",
      title: "Family & dependents",
      dot: fits ? "green" : "amber",
      timelineRefs: refs([...fs, ...fo]),
      facts: {
        monthlySupportMinorUnits: monthlySupport,
        monthlyEquivalentYearlyObligationsMinorUnits: monthlyEquivOblig,
        combinedMonthlyMinorUnits: combined,
        monthlySurplusMinorUnits: surplus,
        fitsWithinCurrentSurplus: fits,
        obligations: fo.map((o) => ({
          label: o.label,
          costPerYearMinorUnits: o.costPerYearMinorUnits,
          forHowManyYears: o.forHowManyYears,
          timeline: labelById.get(o.timelineId),
        })),
      },
    });
  }

  const shortTerm = inputs.tl.goals.filter((g) => g.horizon === "shortTerm");
  if (shortTerm.length > 0) {
    const obligTimelines = new Set(fo.map((o) => o.timelineId));
    const overlapping = shortTerm.filter((g) => obligTimelines.has(g.timelineId));
    const hasOverlap = overlapping.length > 0;
    categories.push({
      key: "shortTermGoal",
      title: "Short-term goal",
      dot: hasOverlap ? "amber" : "green",
      timelineRefs: refs(shortTerm),
      facts: {
        goals: shortTerm.map((g) => ({ description: g.description, timeline: labelById.get(g.timelineId) })),
        overlapsWithFamilyObligation: hasOverlap,
        overlapDetail: hasOverlap
          ? overlapping
              .map((g) => `"${g.description}" shares ${labelById.get(g.timelineId)} with a yearly family obligation`)
              .join("; ")
          : "",
        monthlySurplusMinorUnits: surplus,
      },
    });
  }

  const career = inputs.tl.goals.filter((g) => g.horizon === "longTerm");
  if (career.length > 0) {
    const withIncome = career.filter((g) => g.targetAmountMinorUnits !== undefined);
    const hasExpected = withIncome.length > 0;
    categories.push({
      key: "careerIncome",
      title: "Career & income",
      dot: hasExpected ? "green" : "amber",
      timelineRefs: refs(career),
      facts: {
        goals: career.map((g) => ({
          description: g.description,
          expectedAnnualIncomeMinorUnits: g.targetAmountMinorUnits ?? null,
          timeline: labelById.get(g.timelineId),
        })),
        hasExpectedIncomeFigure: hasExpected,
      },
    });
  }

  const sideIncome = inputs.tl.situations.filter((s) => s.situationCategory === "sideIncome");
  if (sideIncome.length > 0) {
    categories.push({
      key: "sideIncome",
      title: "Side income",
      dot: "amber",
      timelineRefs: refs(sideIncome),
      facts: {
        ideas: sideIncome.map((s) => ({ description: s.description, timeline: labelById.get(s.timelineId) })),
        assessed: false,
        note: "Not yet assessed — a deeper look belongs in Side Income & Business Planning.",
      },
    });
  }

  const loans = inputs.tl.loans;
  if (loans.length > 0) {
    const plannedEmi = loans.reduce((s, x) => s + x.emiMinorUnits, 0);
    const monthlySupport = fs.reduce((s, x) => s + x.monthlyCostMinorUnits, 0);
    const surplusAfter = surplus - monthlySupport - plannedEmi;
    categories.push({
      key: "loans",
      title: "Loans",
      dot: surplusAfter >= 0 ? "green" : "amber",
      timelineRefs: refs(loans),
      facts: {
        totalPlannedEmiMinorUnits: plannedEmi,
        monthlySurplusAfterSupportAndPlannedEmiMinorUnits: surplusAfter,
        loans: loans.map((l) => ({
          label: l.label,
          emiMinorUnits: l.emiMinorUnits,
          balanceMinorUnits: l.outstandingBalanceMinorUnits,
          timeline: labelById.get(l.timelineId),
        })),
      },
    });
  }

  const gaps: string[] = [];
  if (inputs.ff.income.length <= 1) gaps.push("The household relies on a single income source.");
  if (inputs.ff.obligations.length > 0 || loans.length > 0)
    gaps.push("There are existing or planned loan EMIs.");
  if (inputs.tl.situations.some((s) => s.situationCategory === "familyEmergency"))
    gaps.push("A family emergency risk has been noted but not funded.");
  if (fo.length > 0) gaps.push("An upcoming multi-year family obligation is planned.");
  if (runway.status === "depleting" && (runway.runwayMonths ?? 0) < 6)
    gaps.push("Current runway is under six months.");

  return {
    runway: {
      status: runway.status,
      months: runway.runwayMonths,
      monthlySurplusMinorUnits: surplus,
      liquidSavingsMinorUnits: runway.unrestrictedLiquidSavingsMinorUnits,
      essentialMonthlyExpensesMinorUnits: runway.essentialMonthlyExpensesMinorUnits,
      totalEmiMinorUnits: runway.totalEmiMinorUnits,
      dependableMonthlyIncomeMinorUnits: runway.dependableMonthlyIncomeMinorUnits,
    },
    categoryKeys: categories.map((c) => c.key),
    categories,
    gaps,
  };
}

// ---------------------------------------------------------------------
// What-if scenario detection + arithmetic
// ---------------------------------------------------------------------

type Scenario =
  | { type: "incomeLoss"; months: number }
  | { type: "emiIncrease"; percent: number }
  | { type: "oneTimeExpense"; amountRupees: number }
  | { type: "incomeIncrease"; amountRupees: number }
  | { type: "generic" };

function parseRupees(text: string): number | null {
  const lakh = text.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|l\b)/i);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const k = text.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (k) return Math.round(Number(k[1]) * 1000);
  const plain = text.replace(/,/g, "").match(/(\d{4,})/);
  if (plain) return Number(plain[1]);
  return null;
}

function detectScenario(question: string): Scenario {
  const q = question.toLowerCase();
  const monthsMatch = q.match(/(\d+)\s*month/);
  const pctMatch = q.match(/(\d+)\s*%|\bby\s*(\d+)\b/);

  if (
    /\b(lost|lose|losing|no|stopped?|without|unemploy|laid off|redundan)\b/.test(q) &&
    /\b(job|income|salary|work|paycheck)\b/.test(q)
  ) {
    return { type: "incomeLoss", months: monthsMatch ? Number(monthsMatch[1]) : 6 };
  }
  if (/(emi|loan|repayment|mortgage)/.test(q) && /(increase|rise|rose|went up|higher|%|percent)/.test(q)) {
    const p = pctMatch ? Number(pctMatch[1] ?? pctMatch[2]) : 20;
    return { type: "emiIncrease", percent: p };
  }
  if (/(emergency|sudden|lump ?sum|one[- ]?time|unexpected|needed|expense)/.test(q) && /\d/.test(q)) {
    return { type: "oneTimeExpense", amountRupees: parseRupees(q) ?? 100000 };
  }
  if (/(raise|promotion|more income|earn more|income increase|extra income|new job|side income)/.test(q)) {
    return { type: "incomeIncrease", amountRupees: parseRupees(q) ?? 10000 };
  }
  return { type: "generic" };
}

type Computed = { stats: { label: string; value: string }[]; detail: string };

function applyScenario(scenario: Scenario, r: RunwayResult): Computed {
  const S = r.unrestrictedLiquidSavingsMinorUnits;
  const G = r.monthlyNetGapMinorUnits;
  const I = r.dependableMonthlyIncomeMinorUnits;
  const E = r.totalEmiMinorUnits;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const monthsStr = (s: number, g: number) => (g > 0 ? `${(s / g).toFixed(1)} months` : "not depleting");

  switch (scenario.type) {
    case "incomeLoss": {
      const burn = G + I;
      const covered = burn > 0 ? S / burn : Infinity;
      const shortfall = burn > 0 ? Math.max(0, burn * scenario.months - S) : 0;
      return {
        stats: [
          { label: "Months your savings cover", value: covered === Infinity ? "indefinite" : covered.toFixed(1) },
          { label: "Months asked about", value: String(scenario.months) },
          { label: "Shortfall over that period", value: shortfall > 0 ? fmt(shortfall) : "none" },
        ],
        detail: `Baseline from your runway: liquid savings ${fmt(S)}, current monthly gap ${fmt(
          G,
        )}, dependable income ${fmt(I)}. With income at zero the monthly burn becomes ${fmt(
          burn,
        )} (gap + lost income). ${fmt(S)} ÷ ${fmt(burn)} = ${
          covered === Infinity ? "no depletion" : `${covered.toFixed(1)} months`
        }.`,
      };
    }
    case "emiIncrease": {
      const delta = (E * scenario.percent) / 100;
      const newG = G + delta;
      return {
        stats: [
          { label: "Added monthly EMI", value: fmt(delta) },
          { label: "New monthly gap", value: fmt(newG) },
          { label: "Runway after", value: monthsStr(S, newG) },
        ],
        detail: `Current EMI total ${fmt(E)}. A ${scenario.percent}% increase adds ${fmt(
          delta,
        )}/month, widening the gap from ${fmt(G)} to ${fmt(newG)}. ${fmt(S)} ÷ ${fmt(newG)} = ${monthsStr(
          S,
          newG,
        )}.`,
      };
    }
    case "oneTimeExpense": {
      const newS = Math.max(S - scenario.amountRupees, 0);
      return {
        stats: [
          { label: "One-time expense", value: fmt(scenario.amountRupees) },
          { label: "Liquid savings after", value: fmt(newS) },
          { label: "Runway after", value: monthsStr(newS, G) },
        ],
        detail: `A one-time hit of ${fmt(scenario.amountRupees)} to liquid savings (${fmt(S)} → ${fmt(
          newS,
        )}). At the current monthly gap of ${fmt(G)}, runway becomes ${monthsStr(newS, G)}.`,
      };
    }
    case "incomeIncrease": {
      const newG = G - scenario.amountRupees;
      return {
        stats: [
          { label: "Added monthly income", value: fmt(scenario.amountRupees) },
          { label: "New monthly gap", value: newG <= 0 ? "surplus" : fmt(newG) },
          { label: "Runway after", value: newG <= 0 ? "not depleting" : monthsStr(S, newG) },
        ],
        detail: `Adding ${fmt(scenario.amountRupees)}/month narrows the gap from ${fmt(G)} to ${fmt(
          newG,
        )}. ${
          newG <= 0
            ? "The household would no longer be drawing down savings."
            : `${fmt(S)} ÷ ${fmt(newG)} = ${monthsStr(S, newG)}.`
        }`,
      };
    }
    default:
      return {
        stats: [
          {
            label: "Current runway",
            value: r.status === "not_depleting" ? "not depleting" : `${(r.runwayMonths ?? 0).toFixed(1)} months`,
          },
          { label: "Monthly gap", value: fmt(G) },
          { label: "Liquid savings", value: fmt(S) },
        ],
        detail: `No specific scenario was recognised in the question, so this is the current position: liquid savings ${fmt(
          S,
        )}, monthly gap ${fmt(G)}, runway ${
          r.status === "not_depleting" ? "not depleting" : `${(r.runwayMonths ?? 0).toFixed(1)} months`
        }.`,
      };
  }
}

// ---------------------------------------------------------------------
// OpenAI narration
// ---------------------------------------------------------------------

async function chatJson(system: string, user: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ConvexError("OPENAI_API_KEY is not set on this deployment.");
  }
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
  if (!resp.ok) {
    throw new ConvexError(`OpenAI request failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`);
  }
  const data = (await resp.json()) as { choices: { message: { content: string } }[] };
  try {
    return JSON.parse(data.choices[0]?.message.content ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function narrateAnalysis(deterministic: ReturnType<typeof computeDeterministic>): Promise<{
  verdict: string;
  categories: { key: string; summary: string; detail: string }[];
  whatIfChips: string[];
}> {
  const system = `You narrate an already-computed household financial plan analysis for a service called Goal & Situation Planning. You are given a JSON object of deterministic results. Return ONLY a JSON object of this exact shape:
{
  "verdict": string,
  "categories": [ { "key": string, "summary": string, "detail": string } ],
  "whatIfChips": string[]
}
Rules:
- "verdict" is ONE sentence for a banner labelled "Overall".
- Include one "categories" entry for every key in the input's categoryKeys, using the same key strings.
- "summary" is one line. "detail" is 2-3 sentences and must name the specific timeline label(s) from the input's timelineRefs / facts.
- "whatIfChips" is 2 or 3 short questions phrased as "What if ...?", each grounded in one of the entries in the input's "gaps" array. If "gaps" is empty, return an empty array.
- Never introduce a number that is not present in the input.`;
  const parsed = await chatJson(system, JSON.stringify(deterministic));
  const categories = Array.isArray(parsed.categories)
    ? (parsed.categories as { key: string; summary?: string; detail?: string }[]).map((c) => ({
        key: String(c.key),
        summary: typeof c.summary === "string" ? c.summary : "",
        detail: typeof c.detail === "string" ? c.detail : "",
      }))
    : [];
  const whatIfChips = Array.isArray(parsed.whatIfChips)
    ? (parsed.whatIfChips as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3)
    : [];
  return {
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "Your plan has been analysed.",
    categories,
    whatIfChips,
  };
}

async function narrateWhatIf(
  question: string,
  computed: Computed,
): Promise<{ verdict: string; explanation: string }> {
  const system = `You explain a household finance what-if scenario whose numbers have ALREADY been calculated. You are given the user's question and a JSON of computed stats plus a calculation-detail string. Return ONLY JSON: { "verdict": string, "explanation": string }. "verdict" is one sentence answering the question. "explanation" is 2-4 plain sentences. Use only the numbers provided — never introduce, round differently, or change a figure.`;
  const parsed = await chatJson(
    system,
    JSON.stringify({ question, stats: computed.stats, calculationDetail: computed.detail }),
  );
  return {
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "See the calculated numbers below.",
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : computed.detail,
  };
}
