// Deterministic (non-AI) household runway calculation.
//
// runwayMonths = unrestricted liquid savings ÷ monthly net gap
// monthly net gap = essential monthly-equivalent expenses + total EMI −
//                   dependable continuing monthly-equivalent income
//
// If the gap is zero or negative, reserves aren't being depleted, so
// runwayMonths is not reported (dividing by zero/negative is meaningless).
//
// Cadence normalization: an income/expense's cadence isn't necessarily
// "monthly" (incomeSources.cadence and expenses.recurrence both allow
// weekly/annual too), so every amount is converted to a monthly-equivalent
// before summing — weekly × 52/12, annual ÷ 12 — rounded to the nearest
// minor unit (this is a derived read-time figure, not a stored write, so
// Number.isInteger enforcement doesn't apply here). "irregular" income and
// "oneOff" expenses have no steady monthly figure by definition, so they're
// excluded from the recurring monthly total rather than guessed at.
//
// Scope, deliberately: single currency (no FX conversion), and each table
// read is bounded with .take() rather than aggregated — fine for one
// household's finance rows, not a general large-scale aggregate.

import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireMembership } from "./access";

const runwayResult = v.union(
  v.object({
    status: v.literal("not_depleting"),
    runwayMonths: v.null(),
    message: v.string(),
    monthlyNetGapMinorUnits: v.number(),
    unrestrictedLiquidSavingsMinorUnits: v.number(),
    essentialMonthlyExpensesMinorUnits: v.number(),
    totalEmiMinorUnits: v.number(),
    dependableMonthlyIncomeMinorUnits: v.number(),
  }),
  v.object({
    status: v.literal("depleting"),
    runwayMonths: v.number(),
    message: v.string(),
    monthlyNetGapMinorUnits: v.number(),
    unrestrictedLiquidSavingsMinorUnits: v.number(),
    essentialMonthlyExpensesMinorUnits: v.number(),
    totalEmiMinorUnits: v.number(),
    dependableMonthlyIncomeMinorUnits: v.number(),
  }),
);

// Returns the monthly-equivalent of `amount` at the given cadence, or
// `null` when the cadence has no steady monthly figure (irregular income,
// one-off expenses) — the caller excludes those from the recurring total.
function monthlyEquivalent(
  amount: number,
  cadence: "monthly" | "weekly" | "annual" | "irregular" | "oneOff",
): number | null {
  switch (cadence) {
    case "monthly":
      return amount;
    case "weekly":
      return Math.round((amount * 52) / 12);
    case "annual":
      return Math.round(amount / 12);
    case "irregular":
    case "oneOff":
      return null;
  }
}

export const calculateRunway = query({
  // `now` is passed in rather than read from the wall clock inside the
  // query, per the Convex query guidelines (queries aren't rerun just
  // because time advances).
  args: { now: v.number() },
  returns: runwayResult,
  handler: async (ctx, args) => {
    const membership = await requireMembership(ctx);
    const householdId = membership.householdId;

    const [incomeSources, expenses, obligations, assets] = await Promise.all([
      ctx.db
        .query("incomeSources")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .take(1000),
      ctx.db
        .query("expenses")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .take(1000),
      ctx.db
        .query("obligations")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .take(1000),
      ctx.db
        .query("assets")
        .withIndex("by_household", (q) => q.eq("householdId", householdId))
        .take(1000),
    ]);

    const essentialMonthlyExpensesMinorUnits = expenses
      .filter((e) => e.classification === "essential")
      .reduce((sum, e) => {
        const monthly = monthlyEquivalent(e.amountMinorUnits, e.recurrence);
        return monthly === null ? sum : sum + monthly;
      }, 0);

    const totalEmiMinorUnits = obligations.reduce((sum, o) => sum + o.emiMinorUnits, 0);

    const dependableMonthlyIncomeMinorUnits = incomeSources
      .filter(
        (i) =>
          i.reliability === "dependable" &&
          i.activeFrom <= args.now &&
          (i.activeTo === undefined || i.activeTo > args.now),
      )
      .reduce((sum, i) => {
        const monthly = monthlyEquivalent(i.amountMinorUnits, i.cadence);
        return monthly === null ? sum : sum + monthly;
      }, 0);

    const monthlyNetGapMinorUnits =
      essentialMonthlyExpensesMinorUnits + totalEmiMinorUnits - dependableMonthlyIncomeMinorUnits;

    const unrestrictedLiquidSavingsMinorUnits = assets
      .filter((a) => a.liquidity === "liquid" && a.earmarkedForGoalId === undefined)
      .reduce((sum, a) => sum + a.valueMinorUnits, 0);

    if (monthlyNetGapMinorUnits <= 0) {
      return {
        status: "not_depleting" as const,
        runwayMonths: null,
        message: "reserves are not being depleted",
        monthlyNetGapMinorUnits,
        unrestrictedLiquidSavingsMinorUnits,
        essentialMonthlyExpensesMinorUnits,
        totalEmiMinorUnits,
        dependableMonthlyIncomeMinorUnits,
      };
    }

    const runwayMonths = unrestrictedLiquidSavingsMinorUnits / monthlyNetGapMinorUnits;

    return {
      status: "depleting" as const,
      runwayMonths,
      message: `${runwayMonths.toFixed(1)} months of runway at the current burn rate`,
      monthlyNetGapMinorUnits,
      unrestrictedLiquidSavingsMinorUnits,
      essentialMonthlyExpensesMinorUnits,
      totalEmiMinorUnits,
      dependableMonthlyIncomeMinorUnits,
    };
  },
});
