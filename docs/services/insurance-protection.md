# Insurance, Protection & Financial Rights

Know what you're covered for, and where you might be exposed.

## What it does

Category education, an adequacy check (life + health), portability
guidance, and cross-service gap detection — reading real data from
Financial Foundation, Loan & Debt, and Side-Income, never inventing a
policy or a need.

## How the numbers are computed

**Life adequacy**, stated plainly since it needs to be defensible:

```
estimated life cover needed = outstanding loan balance + 10 × dependable annual income
gap = needed − (recorded life cover + bundled loan-linked cover)
```

"10 years of income replacement" is a named, adjustable constant, not
buried in the arithmetic.

**Health adequacy** uses ₹5,00,000 per household member (self + a
`dependentsCount` proxy, since Goal & Situation Planning has no formal
dependents field — the proxy is honestly labeled everywhere it's used)
as a commonly-cited minimum.

**Gap detection** checks three deterministic patterns (no AI decides
whether a gap exists, only whether to narrate it): outstanding debt with
no/insufficient life cover, income concentrated in a single earner with
no/low health cover, and an active side-income business with no
liability-type cover.

Every narration prompt is explicitly instructed to stay descriptive
("there is an estimated gap of ₹X") rather than advisory ("you should
increase it by ₹X") — tightened after an early pass drifted toward
advisory phrasing.

## Real sourced context

Portability guidance is the real, numbered 7-step process from IRDAI's
own Health Insurance Regulations (Schedule-I) — application window,
Portability Form, data-handover window, underwriting decision — not a
paraphrase from training data.

## Key files

- `convex/insuranceRiskPlanning.ts` — adequacy, portability, gap detection
- `convex/insurance.ts` — policy CRUD (Financial Foundation layer)
- `src/components/insurance/InsuranceScreen.tsx`

See [hackathon.md](../../hackathon.md) for the full build and verification history.
