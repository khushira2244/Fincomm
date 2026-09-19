# convex/

Backend for FinComp — see the [project README](../README.md) for what the
app does, and [hackathon.md](../hackathon.md) for the full, evidence-based
build log of every service in this directory.

Each service generally owns its own file (e.g. `loanDebt.ts`,
`insuranceRiskPlanning.ts`, `sideIncome.ts`) plus a shared `schema.ts`,
`access.ts` (household membership + revision bumping), and `auth.ts`
(Convex Auth). `staticSite.ts` + `http.ts`'s catch-all route are deploy
tooling that serve the built frontend from this deployment's own
`*.convex.site` domain — not part of the product itself.

For how to work with Convex functions in general (queries, mutations,
actions, the client hooks), see the [Convex docs](https://docs.convex.dev/functions).
