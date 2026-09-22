#!/usr/bin/env -S npx tsx
// Jurisdiction routing/fallback test suite — the highest-value subset,
// not full coverage (15 tests, priority-ordered per the spec this was
// written against). No existing test harness existed in this project
// (no vitest/convex-test, no *.test.* files), so this is the minimal
// one: real calls against the real DEV deployment via the same safe
// `node node_modules/convex/bin/main.js run ...` invocation already
// proven in scripts/deploy-static-site.mjs (bypasses the Windows
// npx/.cmd quoting bug found earlier this session), plus a few pure
// unit checks (tests 11a and 15) that need no network at all.
//
// Run with: npx tsx scripts/jurisdiction-tests.mts
//
// Uses real households already in the dev deployment (this project has
// no test-data cleanup mechanism, so no throwaway households are
// created except where the test genuinely requires a fresh one — see
// TEST 11b). Every household this script mutates has its country reset
// to "IN" at the end, in a `finally` block, so a failed run doesn't
// leave dev state dirty for manual testing afterward.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseBenchmarkRateBps, parseFedFundsRateBps } from "../convex/rateParsers.ts";
import { resolveCountry } from "../convex/jurisdiction.ts";

const convexCli = fileURLToPath(new URL("../node_modules/convex/bin/main.js", import.meta.url));

// HH_A: the main test household — already has real, previously-verified
// Financial Foundation / Insurance / Investment data (the ₹71,00,000
// life-cover-gap / LIKELY_ADEQUATE / LIMITED_CAPACITY fixtures this
// suite checks against).
const HH_A = "jx74dyj33sdac2qter9cqy6xsx8e5cxn";
// HH_B: a second real household, used only for the cross-isolation
// test — toggled to US and back, never asserted on for its own data.
const HH_B = "jx7dpp4my8rsbvcatcn9wr8qkd8e9fex";
// HH_D: a real household this script NEVER calls updateHouseholdCountry
// on — its `country` field has genuinely never been set (created before
// this feature existed), used to test the real "missing field" case,
// not a simulated one.
const HH_D = "jx79ch6e3tcsnsmf69rfr5f1pn8ehn6v";

let uniqueOfferSeed = 3000000; // bump per call to bust checkAffordability's inputHash cache

function convexRun(fn: string, args: Record<string, unknown>, identitySubject?: string): unknown {
  const cliArgs = [convexCli, "run", fn, JSON.stringify(args)];
  if (identitySubject) cliArgs.push("--identity", JSON.stringify({ subject: identitySubject }));
  const out = execFileSync(process.execPath, cliArgs, { encoding: "utf8" }).trim();
  return out === "" ? null : JSON.parse(out);
}

function convexRunExpectError(fn: string, args: Record<string, unknown>, identitySubject?: string): string {
  const cliArgs = [convexCli, "run", fn, JSON.stringify(args)];
  if (identitySubject) cliArgs.push("--identity", JSON.stringify({ subject: identitySubject }));
  try {
    execFileSync(process.execPath, cliArgs, { encoding: "utf8" });
    return ""; // no error — caller decides if that's a failure
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string };
    return (err.stderr ?? "") + (err.stdout ?? "");
  }
}

function freshOffer() {
  uniqueOfferSeed += 1;
  return {
    principalMinorUnits: uniqueOfferSeed,
    downPaymentMinorUnits: 200000,
    annualRateBasisPoints: 650,
    rateType: "fixed" as const,
    tenureMonths: 60,
    feesMinorUnits: 5000,
  };
}

type Result = { n: number; name: string; pass: boolean; detail: string };
const results: Result[] = [];

function record(n: number, name: string, pass: boolean, detail: string) {
  results.push({ n, name, pass, detail });
  console.log(`${pass ? "✔ PASS" : "✘ FAIL"}  [${n}] ${name}${detail ? " — " + detail : ""}`);
}

function setCountry(subject: string, country: "IN" | "US" | "EU" | "OTHER") {
  convexRun("households:updateHouseholdCountry", { country }, subject);
}

async function main() {
  try {
    // ---- 1. India + Loan & Debt -> RBI, real rate ----
    setCountry(HH_A, "IN");
    {
      const r = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_A) as {
        result: { rateContext: { available: boolean; referenceRatePercent: number | null; sourceUrl: string | null } };
      };
      const rc = r.result.rateContext;
      const pass = rc.available === true && typeof rc.referenceRatePercent === "number" && rc.sourceUrl === "https://www.rbi.org.in/";
      record(1, "IN + Loan&Debt -> RBI, real rate", pass, `available=${rc.available} rate=${rc.referenceRatePercent} url=${rc.sourceUrl}`);
    }

    // ---- 2. US + Loan & Debt -> Fed, real rate ----
    setCountry(HH_A, "US");
    {
      const r = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_A) as {
        result: { rateContext: { available: boolean; referenceRatePercent: number | null; sourceUrl: string | null } };
      };
      const rc = r.result.rateContext;
      const pass = rc.available === true && typeof rc.referenceRatePercent === "number" && rc.sourceUrl === "https://www.federalreserve.gov/releases/h15/";
      record(2, "US + Loan&Debt -> Fed, real rate", pass, `available=${rc.available} rate=${rc.referenceRatePercent} url=${rc.sourceUrl}`);
    }

    // ---- 3. EU + Loan & Debt -> honest fallback, no crash, no fake number ----
    setCountry(HH_A, "EU");
    {
      const r = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_A) as {
        result: { rateContext: { available: boolean; referenceRatePercent: number | null; sourceUrl: string | null; note: string } };
      };
      const rc = r.result.rateContext;
      const pass = rc.available === false && rc.referenceRatePercent === null && rc.sourceUrl === null && /configured yet/i.test(rc.note);
      record(3, "EU + Loan&Debt -> honest fallback, no crash", pass, `available=${rc.available} rate=${rc.referenceRatePercent} note="${rc.note.slice(0, 60)}..."`);
    }

    // ---- 4/5. Tax Planning: IN no caveat, US caveat present ----
    setCountry(HH_A, "IN");
    {
      const r = convexRun("taxPlanning:checkTaxDeductionSummary", {}, HH_A) as { narration: { caveats: string[] } };
      const pass = !r.narration.caveats.some((c) => c.includes("selected region"));
      record(4, "IN + Tax Planning -> NO jurisdiction caveat", pass, `caveats=${r.narration.caveats.length}`);
    }
    setCountry(HH_A, "US");
    {
      const r = convexRun("taxPlanning:checkTaxDeductionSummary", {}, HH_A) as { narration: { caveats: string[] } };
      const hit = r.narration.caveats.find((c) => c.includes("selected region"));
      const pass = !!hit && hit.includes("incometax.gov.in") && hit.includes("United States");
      record(5, "US + Tax Planning -> caveat present, mentions incometax.gov.in + country", pass, hit ? `"${hit.slice(0, 90)}..."` : "no caveat found");
    }

    // ---- 6/7. Insurance: IN no caveat + fixture match, US caveat present ----
    setCountry(HH_A, "IN");
    {
      const r = convexRun("insuranceRiskPlanning:checkInsuranceAdequacy", {}, HH_A) as {
        lifeCoverageGapMinorUnits: number;
        healthCoverageAssessment: string;
        narration: { caveats: string[] };
      };
      const noCaveat = !r.narration.caveats.some((c) => c.includes("selected region"));
      const fixtureMatch = r.lifeCoverageGapMinorUnits === 7100000 && r.healthCoverageAssessment === "LIKELY_ADEQUATE";
      record(6, "IN + Insurance -> NO caveat, matches ₹71,00,000/LIKELY_ADEQUATE fixture", noCaveat && fixtureMatch, `gap=${r.lifeCoverageGapMinorUnits} health=${r.healthCoverageAssessment}`);
    }
    setCountry(HH_A, "US");
    {
      const r = convexRun("insuranceRiskPlanning:checkInsuranceAdequacy", {}, HH_A) as { narration: { caveats: string[] } };
      const hit = r.narration.caveats.find((c) => c.includes("selected region"));
      const pass = !!hit && hit.includes("IRDAI") && hit.includes("United States");
      record(7, "US + Insurance -> caveat present, mentions IRDAI", pass, hit ? `"${hit.slice(0, 90)}..."` : "no caveat found");
    }

    // ---- 8/9. Investment: IN no caveat + fixture match, US caveat present ----
    setCountry(HH_A, "IN");
    {
      const r = convexRun("investment:checkInvestmentReadiness", {}, HH_A) as {
        readinessState: string;
        investableSurplusMinorUnits: number;
        narration: { caveats: string[] };
      };
      const noCaveat = !r.narration.caveats.some((c) => c.includes("selected region"));
      const fixtureMatch = r.readinessState === "LIMITED_CAPACITY" && r.investableSurplusMinorUnits === 56000;
      record(8, "IN + Investment -> NO caveat, matches LIMITED_CAPACITY/56000 fixture", noCaveat && fixtureMatch, `state=${r.readinessState} surplus=${r.investableSurplusMinorUnits}`);
    }
    setCountry(HH_A, "US");
    {
      const r = convexRun("investment:checkInvestmentReadiness", {}, HH_A) as { narration: { caveats: string[] } };
      const hit = r.narration.caveats.find((c) => c.includes("selected region"));
      const pass = !!hit && hit.includes("SEBI") && hit.includes("United States");
      record(9, "US + Investment -> caveat present, mentions SEBI", pass, hit ? `"${hit.slice(0, 90)}..."` : "no caveat found");
    }

    // ---- 10. Cross-household isolation ----
    setCountry(HH_A, "IN");
    setCountry(HH_B, "US"); // a DIFFERENT household, set non-IN, in the same run
    {
      const rTax = convexRun("taxPlanning:checkTaxDeductionSummary", {}, HH_A) as { narration: { caveats: string[] } };
      const rIns = convexRun("insuranceRiskPlanning:checkInsuranceAdequacy", {}, HH_A) as { narration: { caveats: string[] } };
      const rInv = convexRun("investment:checkInvestmentReadiness", {}, HH_A) as { narration: { caveats: string[] } };
      const pass =
        !rTax.narration.caveats.some((c) => c.includes("selected region")) &&
        !rIns.narration.caveats.some((c) => c.includes("selected region")) &&
        !rInv.narration.caveats.some((c) => c.includes("selected region"));
      record(10, "Cross-household isolation: HH_A (IN) unaffected by HH_B (US)", pass, `tax/ins/inv caveat leakage: ${!pass}`);
    }
    setCountry(HH_B, "IN"); // reset HH_B

    // ---- 11a. resolveCountry validates/defaults (pure, no network) ----
    {
      const pass = resolveCountry(undefined) === "IN" && resolveCountry(null) === "IN" && resolveCountry("XX") === "IN" && resolveCountry("US") === "US";
      record(11, "resolveCountry defaults/validates (undefined/null/invalid -> IN, valid passes through)", pass, `resolveCountry(undefined)=${resolveCountry(undefined)} resolveCountry("XX")=${resolveCountry("XX")}`);
    }
    // ---- 11b. ensureHousehold rejects an invalid country at the arg validator (no row created) ----
    {
      const err = convexRunExpectError("households:ensureHousehold", { country: "XX" }, "jx-test-invalid-country-noop");
      const pass = /ArgumentValidationError|does not match validator/i.test(err);
      record(11, "ensureHousehold rejects invalid country (ArgumentValidationError, no row created)", pass, err ? err.split("\n")[0]?.slice(0, 100) : "no error thrown");
    }

    // ---- 12. Changing country changes routing on the NEXT call, not cached from old country ----
    setCountry(HH_A, "IN");
    const rIN = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_A) as { result: { rateContext: { sourceUrl: string | null } } };
    setCountry(HH_A, "US");
    const rUS = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_A) as { result: { rateContext: { sourceUrl: string | null } } };
    {
      const pass = rIN.result.rateContext.sourceUrl === "https://www.rbi.org.in/" && rUS.result.rateContext.sourceUrl === "https://www.federalreserve.gov/releases/h15/";
      record(12, "Changing country changes routing on next call (not cached from old country)", pass, `IN->${rIN.result.rateContext.sourceUrl} then US->${rUS.result.rateContext.sourceUrl}`);
    }

    // ---- 13. Rate-source cache correctly scoped per country (no cross-contamination) ----
    {
      const pass =
        rIN.result.rateContext.sourceUrl?.includes("rbi.org.in") === true &&
        rUS.result.rateContext.sourceUrl?.includes("federalreserve.gov") === true &&
        rIN.result.rateContext.sourceUrl !== rUS.result.rateContext.sourceUrl;
      record(13, "Rate-source cache scoped per country (IN call never returns Fed data or vice versa)", pass, `${rIN.result.rateContext.sourceUrl} != ${rUS.result.rateContext.sourceUrl}`);
    }

    // ---- 14. Missing/malformed country on a real pre-existing household doesn't crash ----
    {
      const r = convexRun("loanDebt:checkAffordability", { offer: freshOffer() }, HH_D) as {
        result: { rateContext: { available: boolean; sourceUrl: string | null } };
      };
      // HH_D's country was never set (real pre-existing household) -> resolveCountry defaults it to IN.
      const pass = r.result.rateContext.sourceUrl === "https://www.rbi.org.in/";
      record(14, "Unset country on a real pre-existing household -> defaults to IN, no crash", pass, `sourceUrl=${r.result.rateContext.sourceUrl}`);
    }

    // ---- 15. Fed rate parser regression test (the newline-separated-values bug) ----
    {
      // A fixture shaped exactly like the real page that broke the first
      // regex ([^\n]-bounded) — each value on its own line/paragraph,
      // not inline. The 5th (most recent) value is 3.88.
      const fixture = `Federal funds (effective) [1][2][3]

 3.63

 3.63

 3.63

 3.88

 3.88

Federal funds (target rate) [1][2]

 3.75-4.00 `;
      const bps = parseFedFundsRateBps(fixture);
      const pass = bps === 388;
      record(15, "Fed rate parser regression: newline-separated values, 5th (most recent) extracted", pass, `parsed=${bps} bps (expected 388)`);

      // Bonus check, not separately numbered: the OLD ([^\n]-bounded)
      // regex against this exact fixture would have matched zero
      // characters after the label and returned null — confirms this
      // fixture genuinely reproduces the original bug, not a fixture
      // that happens to work with either regex.
      const oldRegexWouldFail = fixture.match(/federal funds \(effective\)[^\n]{0,200}/i);
      const oldRegexNumbers = oldRegexWouldFail ? [...oldRegexWouldFail[0].matchAll(/(\d{1,2}\.\d{1,2})/g)] : [];
      console.log(`       (confirms old buggy regex would have found ${oldRegexNumbers.length} numbers in this fixture, i.e. would have returned null)`);

      // India parser sanity check alongside — same file, cheap to include.
      const inFixture = "Current Rates\nPolicy Repo Rate | :<br> 5.25%\nOther Rates...";
      const inBps = parseBenchmarkRateBps(inFixture);
      record(15, "RBI parser regression: unaffected by the extraction (still parses 5.25%)", inBps === 525, `parsed=${inBps} bps (expected 525)`);
    }
  } finally {
    // Always leave dev state clean, even if an assertion above threw.
    setCountry(HH_A, "IN");
    setCountry(HH_B, "IN");
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${results.length} checks passed.`);
  if (passCount !== results.length) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.pass)) console.log(`  [${r.n}] ${r.name} — ${r.detail}`);
    process.exit(1);
  }
}

void main();
