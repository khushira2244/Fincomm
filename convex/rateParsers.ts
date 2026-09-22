// Pure, dependency-free benchmark-rate parsers — deliberately kept out
// of loanDebt.ts (which pulls in Convex runtime bindings and component
// clients that only resolve correctly inside a live Convex function) so
// these can be unit-tested directly with `npx tsx`, no dev deployment
// or network call required. See scripts/jurisdiction-tests.mts.

// Deterministic parse (regex, never AI) of a benchmark percentage from
// scraped markdown. Returns basis points or null. Targets RBI's own
// "Current Rates" table first (e.g. "Policy Repo Rate | :<br> 5.25%");
// falls back to looser phrasing so a markup change degrades gracefully
// instead of going silent.
export function parseBenchmarkRateBps(markdown: string): number | null {
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

// Deterministic parse of the US Federal Reserve's H.15 release
// ("Selected Interest Rates"). Verified live 2026-09-22 by fetching the
// real page: the "Federal funds (effective)" label is followed by
// footnote markers, then five daily values EACH ON ITS OWN LINE (not
// inline/pipe-separated like RBI's table), e.g.
//   "Federal funds (effective) [1][2][3]\n\n 3.63 \n\n 3.63 \n\n 3.88 \n\n 3.88"
// so the match window must span newlines (a plain [^\n]-bounded window,
// tried first, matched zero characters and always returned null — a
// real bug caught by testing against the live page, not assumed).
// Takes the LAST percentage-shaped number in that window — the most
// recent day, not the first — since this is a multi-day series unlike
// RBI's single current-value table.
export function parseFedFundsRateBps(markdown: string): number | null {
  const m = markdown.match(/federal funds \(effective\)[\s\S]{0,400}/i);
  if (!m) return null;
  // The row is always 5 business-day columns (H.15's standard weekly
  // format) — take exactly the first 5 numbers after the label and use
  // the 5th (most recent), rather than scanning further into the window
  // and risking picking up a number from the NEXT rate series' own row.
  const numbers = [...m[0].matchAll(/(\d{1,2}\.\d{1,2})/g)].map((mm) => Number(mm[1])).slice(0, 5);
  const last = numbers.length === 5 ? numbers[4] : null;
  if (last === null || last < 0 || last > 25) return null;
  return Math.round(last * 100);
}
