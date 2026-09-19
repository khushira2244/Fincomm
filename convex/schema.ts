// =====================================================================
// Household Economic Resilience Platform — Convex Schema Design (v3)
// FINAL draft pending your approval. Incorporates two review passes:
// generic references, agent-run traceability, provenance, event
// tables, required-field hardening, revision scoping discipline,
// and timestamp/currency consistency.
// =====================================================================

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // ===================================================================
  // IDENTITY
  // ===================================================================

  users: defineTable({
    authId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
  }).index("by_authId", ["authId"]),

  households: defineTable({
    name: v.string(),
    createdBy: v.id("users"),
    isDemoData: v.boolean(),
    // IMPORTANT: only increment this for DECISION-AFFECTING changes
    // (income/expense/obligation/goal/situation edits, confirmed
    // extracted facts). Never increment for UI preferences,
    // notification-read status, or other harmless profile changes —
    // doing so would falsely obsolete unrelated agent runs (e.g. a
    // Tax Agent mid-calculation shouldn't die because someone toggled
    // a notification setting). Enforce this rule in mutation code,
    // not here — the schema can't express "meaningful" on its own.
    stateRevision: v.number(),
    updatedAt: v.number(),
  }),

  memberships: defineTable({
    householdId: v.id("households"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("member"),
      v.literal("adviser"),
      v.literal("temporary_delegate"),
    ),
    visibilityScope: v.union(v.literal("full"), v.literal("restricted")),
    expiresAt: v.optional(v.number()), // required in practice for temporary_delegate
  })
    .index("by_household", ["householdId"])
    .index("by_user", ["userId"])
    .index("by_household_user", ["householdId", "userId"]),

  // ===================================================================
  // FINANCE — now with createdAt/updatedAt/createdByMemberId + currency
  // consistency. Enforce `Number.isInteger(amountMinorUnits)` in every
  // mutation that writes one — Convex's v.number() is a float64 and
  // cannot itself guarantee an integer value.
  // ===================================================================

  incomeSources: defineTable({
    householdId: v.id("households"),
    ownerMemberId: v.id("memberships"),
    label: v.string(),
    amountMinorUnits: v.number(), // MUST be validated as integer in mutation code
    currency: v.string(),
    cadence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("annual"),
      v.literal("irregular"),
    ),
    reliability: v.union(
      v.literal("dependable"),
      v.literal("uncertain"),
      v.literal("hypothetical"),
    ),
    activeFrom: v.number(),
    activeTo: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
  })
    .index("by_household", ["householdId"])
    .index("by_household_active", ["householdId", "activeTo"]),

  expenses: defineTable({
    householdId: v.id("households"),
    label: v.string(),
    amountMinorUnits: v.number(),
    currency: v.string(),
    classification: v.union(v.literal("essential"), v.literal("flexible")),
    recurrence: v.union(
      v.literal("monthly"),
      v.literal("weekly"),
      v.literal("annual"),
      v.literal("oneOff"),
    ),
    paymentDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
  }).index("by_household", ["householdId"]),

  obligations: defineTable({
    householdId: v.id("households"),
    label: v.string(),
    balanceMinorUnits: v.number(),
    emiMinorUnits: v.number(),
    currency: v.string(), // FIXED: was missing currency entirely
    interestRateBasisPoints: v.number(), // legacy, Financial Foundation hardcodes 0
    dueDayOfMonth: v.number(),
    penaltyPolicy: v.optional(v.string()),
    maturityDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
    // Loan & Debt Resilience (Session 1) — all optional. Absent means
    // "not entered yet"; the service surfaces that as a missing-data
    // warning rather than guessing. Integer rules enforced in the
    // loanDebt.updateLoanDetails mutation, not here.
    obligationType: v.optional(
      v.union(
        v.literal("homeLoan"),
        v.literal("personalLoan"),
        v.literal("vehicleLoan"),
        v.literal("educationLoan"),
        v.literal("other"),
      ),
    ),
    annualRateBasisPoints: v.optional(v.number()), // authoritative rate; 0 = genuine zero-interest
    rateType: v.optional(v.union(v.literal("fixed"), v.literal("floating"))),
    remainingTenureMonths: v.optional(v.number()), // integer >= 1
    originalPrincipalMinorUnits: v.optional(v.number()),
    minimumPaymentMinorUnits: v.optional(v.number()),
    feesMinorUnits: v.optional(v.number()),
    prepaymentTerms: v.optional(v.string()), // free text — explained by AI, not parsed for the charge
    nextResetDate: v.optional(v.number()), // floating-rate reset timestamp
    sourceDocumentId: v.optional(v.id("documents")),
    // Insurance & Risk Planning prep (see insurancePolicies below). Some
    // loans (home loans especially) bundle life/credit insurance that
    // covers some or all of the outstanding balance on death. Purely
    // informational surfacing in Debt Overview and loan narration — never
    // read by the affordability/prepayment calculations themselves.
    bundledInsuranceCoverageMinorUnits: v.optional(v.number()), // MUST be integer when present — enforced in updateLoanDetails
  }).index("by_household", ["householdId"]),

  assets: defineTable({
    householdId: v.id("households"),
    label: v.string(),
    valueMinorUnits: v.number(),
    currency: v.string(),
    liquidity: v.union(
      v.literal("liquid"),
      v.literal("semiLiquid"),
      v.literal("illiquid"),
    ),
    earmarkedForGoalId: v.optional(v.id("goals")),
    saleCostEstimateMinorUnits: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
  }).index("by_household", ["householdId"]),

  // Insurance & Risk Planning prep (Service #7 groundwork — this table is
  // raw fact-capture only; no adequacy calculation reads it yet). Same
  // FINANCE-table shape as incomeSources/expenses/obligations/assets
  // above. Written by a plain add mutation (fact-capture form) and by
  // Document Intelligence's extraction-confirm flow — never AI-applied
  // directly.
  insurancePolicies: defineTable({
    householdId: v.id("households"),
    type: v.union(
      v.literal("life"),
      v.literal("health"),
      v.literal("motor"),
      v.literal("property"),
      v.literal("personalAccident"),
      v.literal("other"),
    ),
    coverageAmountMinorUnits: v.number(), // MUST be integer — enforced in addInsurancePolicy
    premiumMinorUnits: v.number(), // MUST be integer — enforced in addInsurancePolicy
    premiumFrequency: v.union(v.literal("monthly"), v.literal("annual")),
    currency: v.string(),
    insurerName: v.optional(v.string()),
    policyNumber: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
  }).index("by_household", ["householdId"]),

  // ===================================================================
  // GOALS
  // ===================================================================

  goals: defineTable({
    householdId: v.id("households"),
    ownerMemberIds: v.array(v.id("memberships")),
    description: v.string(),
    targetAmountMinorUnits: v.optional(v.number()),
    targetDate: v.optional(v.number()),
    priority: v.number(),
    minimumAcceptableOutcome: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("achieved"),
      v.literal("abandoned"),
      v.literal("disputed"),
    ),
    // Added for Goal & Situation Planning (Service #2). All optional —
    // existing goals (there are none yet) and any future non-timeline
    // goal remain valid.
    timelineId: v.optional(v.id("timelines")),
    positiveSteps: v.optional(v.array(v.string())),
    negativeSteps: v.optional(v.array(v.string())),
    horizon: v.optional(v.union(v.literal("shortTerm"), v.literal("longTerm"))),
  }).index("by_household", ["householdId"]),

  situations: defineTable({
    householdId: v.id("households"),
    kind: v.union(v.literal("observed"), v.literal("planned"), v.literal("hypothetical")),
    description: v.string(),
    effectiveDate: v.number(),
    durationDays: v.optional(v.number()),
    affectedMemberIds: v.array(v.id("memberships")),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    // Added for Goal & Situation Planning (Service #2). Optional —
    // situationCategory routes a situation back to its Timeline-detail
    // section (Health / Location / Side income / Misc / Family emergency).
    timelineId: v.optional(v.id("timelines")),
    situationCategory: v.optional(
      v.union(
        v.literal("familyEmergency"),
        v.literal("health"),
        v.literal("location"),
        v.literal("sideIncome"),
        v.literal("misc"),
      ),
    ),
  }).index("by_household", ["householdId"]),

  // ===================================================================
  // EVIDENCE
  // ===================================================================

  documents: defineTable({
    householdId: v.id("households"),
    sourceType: v.string(),
    externalRef: v.optional(v.string()),
    title: v.optional(v.string()),
    receivedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_source", ["householdId", "sourceType"]),

  extractedFacts: defineTable({
    documentId: v.id("documents"),
    householdId: v.id("households"),
    targetEntityType: v.string(),
    targetEntityId: v.optional(v.string()),
    claimedValue: v.any(),
    supportingPassage: v.optional(v.string()),
    verificationStatus: v.union(
      v.literal("extracted"),
      v.literal("userConfirmed"),
      v.literal("disputed"),
      v.literal("stale"),
    ),
  })
    .index("by_household", ["householdId"])
    .index("by_document", ["documentId"]),

  sourceRegistry: defineTable({
    url: v.string(),
    label: v.optional(v.string()),
    isAllowlisted: v.boolean(),
    jurisdiction: v.optional(v.string()),
    authorityLevel: v.optional(v.string()),
    verificationStatus: v.optional(v.string()),
  }).index("by_url", ["url"]),

  sourceSnapshots: defineTable({
    sourceRegistryId: v.id("sourceRegistry"),
    fetchedAt: v.number(),
    contentSummary: v.string(),
    firecrawlPageRef: v.optional(v.string()),
    effectiveFrom: v.optional(v.number()),
    effectiveTo: v.optional(v.number()),
    lastVerifiedAt: v.optional(v.number()),
    nextReviewAt: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    supersedesSnapshotId: v.optional(v.id("sourceSnapshots")),
    // Loan & Debt Resilience: the benchmark rate parsed deterministically
    // (regex, never AI) from the scraped page. Optional — extraction can
    // fail without breaking anything downstream.
    extractedRateBasisPoints: v.optional(v.number()),
  }).index("by_source", ["sourceRegistryId"]),

  // ===================================================================
  // MEMORY
  // ===================================================================

  memories: defineTable({
    householdId: v.id("households"),
    kind: v.string(),
    subjectEntityType: v.string(),
    subjectEntityId: v.string(),
    statement: v.any(),
    verificationStatus: v.union(
      v.literal("userDeclared"),
      v.literal("extracted"),
      v.literal("externallySupported"),
      v.literal("independentlyVerified"),
      v.literal("assumed"),
      v.literal("disputed"),
      v.literal("stale"),
      v.literal("unknown"),
    ),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    recordedAt: v.number(),
    supersedesMemoryId: v.optional(v.id("memories")),
    createdByAgentId: v.optional(v.string()),
    sourceDecisionBasisId: v.optional(v.id("decisionBasis")),
    confidence: v.optional(v.number()),
  })
    .index("by_household", ["householdId"])
    .index("by_household_subject", ["householdId", "subjectEntityType", "subjectEntityId"]),

  dependencyEdges: defineTable({
    householdId: v.id("households"),
    sourceEntityType: v.string(),
    affectedEntityType: v.string(),
    affectedEntityId: v.optional(v.string()),
    reason: v.optional(v.string()),
  }).index("by_household_source", ["householdId", "sourceEntityType"]),

  memoryChallenges: defineTable({
    memoryId: v.id("memories"),
    householdId: v.id("households"),
    challengedByMemberId: v.id("memberships"),
    proposedCorrection: v.any(),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("rejected")),
    evidenceRef: v.optional(v.string()),
  })
    .index("by_memory", ["memoryId"])
    .index("by_household", ["householdId"]),

  // ===================================================================
  // REASONING
  // ===================================================================

  agentRuns: defineTable({
    householdId: v.id("households"),
    agentId: v.string(),
    inputStateRevision: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("obsolete"),
    ),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    serviceId: v.string(), // FIXED: now required — every run must declare its owning service
    triggerEventId: v.optional(v.string()),
    decisionBasisId: v.optional(v.id("decisionBasis")),
    outputPlanVersionId: v.optional(v.id("planVersions")),
    idempotencyKey: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorSummary: v.optional(v.string()),
  })
    .index("by_household", ["householdId"])
    .index("by_household_agent", ["householdId", "agentId"]),

  calculationRuns: defineTable({
    householdId: v.id("households"),
    calculationType: v.string(),
    inputsSnapshot: v.any(),
    resultSnapshot: v.any(),
    computedAt: v.number(),
  }).index("by_household", ["householdId"]),

  planVersions: defineTable({
    householdId: v.id("households"),
    planType: v.string(),
    version: v.number(),
    status: v.union(
      v.literal("current"),
      v.literal("stale"),
      v.literal("obsolete"),
      v.literal("needsReview"),
    ),
    decisionBasisId: v.id("decisionBasis"),
    supersedesVersion: v.optional(v.number()),
  })
    .index("by_household_type", ["householdId", "planType"])
    .index("by_household_type_status", ["householdId", "planType", "status"]),

  decisionBasis: defineTable({
    householdId: v.id("households"),
    consumedMemoryIds: v.array(v.id("memories")),
    consumedFactIds: v.array(v.id("extractedFacts")),
    assumptions: v.array(v.string()),
    calculationRunIds: v.array(v.id("calculationRuns")),
    uncertaintyNotes: v.optional(v.string()),
  }).index("by_household", ["householdId"]),

  // Domain event tables — all now carry stateRevision + actorType so
  // any concurrent-change debugging can reconstruct exactly what
  // happened and in what order, per correction #3.
  financialEvents: defineTable({
    householdId: v.id("households"),
    eventType: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    occurredAt: v.number(),
    stateRevision: v.number(),
    actorType: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("system"),
      v.literal("external"),
    ),
  })
    .index("by_household", ["householdId"])
    .index("by_household_type", ["householdId", "eventType"]),

  memoryEvents: defineTable({
    householdId: v.id("households"),
    eventType: v.string(),
    memoryId: v.id("memories"),
    occurredAt: v.number(),
    stateRevision: v.number(),
    actorType: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("system"),
      v.literal("external"),
    ),
  }).index("by_household", ["householdId"]),

  planInvalidationEvents: defineTable({
    householdId: v.id("households"),
    planVersionId: v.id("planVersions"),
    // FIXED: generic trigger reference — a plan can be invalidated by
    // a financial change, a corrected memory, an updated source/policy,
    // a new situation, or a manual override. Not just financialEvents.
    triggerCategory: v.union(
      v.literal("financial"),
      v.literal("memory"),
      v.literal("source"),
      v.literal("situation"),
      v.literal("manual"),
    ),
    triggerEventId: v.string(),
    reason: v.string(),
    occurredAt: v.number(),
    stateRevision: v.number(),
    actorType: v.union(
      v.literal("user"),
      v.literal("agent"),
      v.literal("system"),
      v.literal("external"),
    ),
  }).index("by_household", ["householdId"]),

  // ===================================================================
  // COORDINATION
  // ===================================================================

  approvals: defineTable({
    householdId: v.id("households"),
    decisionBasisId: v.id("decisionBasis"),
    requestedByMemberId: v.id("memberships"),
    approverMemberId: v.optional(v.id("memberships")),
    status: v.union(v.literal("pending"), v.literal("granted"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.optional(v.number()),
    // FIXED: now required — an approval must always state exactly what
    // it authorizes, so a simulation can never be mistaken for a real
    // financial action.
    actionType: v.string(),
    targetEntityType: v.string(),
    targetEntityId: v.optional(v.string()),
    requestedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    reason: v.optional(v.string()),
  }).index("by_household", ["householdId"]),

  notifications: defineTable({
    householdId: v.id("households"),
    memberId: v.id("memberships"),
    message: v.string(),
    linkedPlanVersionId: v.optional(v.id("planVersions")),
    read: v.boolean(),
    createdAt: v.number(),
  }).index("by_member", ["memberId"]),

  // ===================================================================
  // RELIABILITY
  // ===================================================================

  auditEvents: defineTable({
    householdId: v.id("households"),
    eventType: v.string(),
    actorType: v.union(v.literal("user"), v.literal("system")),
    actorId: v.optional(v.string()),
    payloadSummary: v.any(),
    occurredAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_type", ["householdId", "eventType"]),

  idempotencyRecords: defineTable({
    operationScope: v.string(),
    actorContext: v.string(),
    requestHash: v.string(),
    resultRef: v.optional(v.string()),
    // FIXED: now required — an idempotency record with no household
    // or status is unsafe to rely on for dedup.
    householdId: v.id("households"),
    status: v.string(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_scope_hash", ["operationScope", "requestHash"]),

  webhookEvents: defineTable({
    source: v.string(),
    externalEventId: v.string(),
    processedAt: v.number(),
    // FIXED: now required — needed to correctly detect and retry
    // failed/partial webhook deliveries.
    receivedAt: v.number(),
    processingStatus: v.string(),
    attemptCount: v.number(),
    payloadHash: v.optional(v.string()),
    lastError: v.optional(v.string()),
  }).index("by_source_event", ["source", "externalEventId"]),

  // ===================================================================
  // GOAL & SITUATION PLANNING (Service #2) — additive. Timeline-scoped
  // planning data lives entirely in its own tables and never touches
  // Financial Foundation's expenses/obligations/runway (Option A).
  // ===================================================================

  timelines: defineTable({
    householdId: v.id("households"),
    label: v.string(), // "Timeline 1", "Timeline 2" — set sequentially at creation
    yearsLabel: v.string(), // free text the user types, e.g. "Year 1-3"; starts ""
    order: v.number(), // 1-based sequence position; = N at creation
    createdAt: v.number(),
    // Set false at creation; flipped true by the "Confirm & see my
    // analysis" button on the timeline detail page. Only confirmed
    // timelines feed plan analysis. Optional so the timelines created
    // before this field existed still validate (they read as unconfirmed).
    confirmed: v.optional(v.boolean()),
  }).index("by_household", ["householdId"]),

  // Family & Dependents > monthly support. Kept out of the expenses
  // table so it can't leak into the current runway.
  timelineFamilySupport: defineTable({
    householdId: v.id("households"),
    timelineId: v.id("timelines"),
    label: v.string(),
    monthlyCostMinorUnits: v.number(), // integer-enforced in mutation
  }).index("by_household", ["householdId"]),

  // Family & Dependents > yearly obligations (with a reason and a set
  // number of years).
  familyObligations: defineTable({
    householdId: v.id("households"),
    timelineId: v.id("timelines"),
    label: v.string(),
    costPerYearMinorUnits: v.number(), // integer-enforced in mutation
    forHowManyYears: v.number(), // integer-enforced (whole years)
    reason: v.optional(v.string()),
  }).index("by_household", ["householdId"]),

  // Loans planned within a timeline. Kept out of the obligations table
  // so it can't leak into the current runway's EMI total.
  timelineLoans: defineTable({
    householdId: v.id("households"),
    timelineId: v.id("timelines"),
    label: v.string(),
    outstandingBalanceMinorUnits: v.number(), // integer-enforced in mutation
    emiMinorUnits: v.number(), // integer-enforced in mutation
  }).index("by_household", ["householdId"]),

  // A dismissed suggestion never reappears for this
  // household + timeline + suggestionKey.
  suggestionDismissals: defineTable({
    householdId: v.id("households"),
    timelineId: v.id("timelines"),
    suggestionKey: v.string(),
    dismissedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_timeline_key", ["householdId", "timelineId", "suggestionKey"]),

  // Cached plan analyses. Keyed on the exact set of confirmed timelines
  // that were included (so {T1} and {T1,T2} are distinct cache entries)
  // plus the household stateRevision at generation time — a match on
  // both means the cached result is still current, no fresh OpenAI call.
  planAnalyses: defineTable({
    householdId: v.id("households"),
    timelineIds: v.array(v.id("timelines")), // stored sorted
    inputStateRevision: v.number(),
    result: v.any(), // { verdict, categories, whatIfChips, deterministic }
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // Loan & Debt Resilience decision history. Unlike planAnalyses, rows
  // here are NEVER pruned or overwritten — every generation inserts a
  // new version. A cache hit is the most-recent row matching
  // householdId + analysisType + obligationId + inputHash whose
  // inputStateRevision equals the household's current stateRevision.
  // "overview" is not persisted in Session 1 (pure live query).
  loanAnalyses: defineTable({
    householdId: v.id("households"),
    obligationId: v.optional(v.id("obligations")), // set for "prepayment"; absent for "affordability"
    analysisType: v.union(
      v.literal("affordability"),
      v.literal("prepayment"),
      v.literal("prepaymentTarget"), // reverse mode: solve for the payment given a target payoff date
      v.literal("overview"),
    ),
    inputHash: v.string(), // stable hash of the deterministic inputs
    inputStateRevision: v.number(),
    result: v.any(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // ===================================================================
  // SIDE-INCOME & BUSINESS PLANNING (Service #5). Reuses sourceRegistry /
  // sourceSnapshots (defined above, under Loan & Debt) for all
  // Firecrawl-backed data — those two tables aren't household-scoped, so
  // raw search/scrape snapshots can be shared across households while
  // the generated, personalized results below (sideIncomeOpportunities,
  // sideIncomeDeepDives) stay scoped per household + entry.
  // ===================================================================

  sideIncomeEntries: defineTable({
    householdId: v.id("households"),
    timelineId: v.optional(v.id("timelines")), // optional link into Goal & Situation Planning
    kind: v.union(v.literal("job"), v.literal("business")),
    source: v.union(v.literal("userDeclared"), v.literal("routedFromLoanDebt")),
    routedGapMinorUnits: v.optional(v.number()), // pre-filled target if routed from a Loan & Debt shortfall
    status: v.union(
      v.literal("exploring"),
      v.literal("selected"),
      v.literal("active"),
      v.literal("graduated"),
    ),
    // Deliberately separate from `status` — status is plan progress,
    // earningsEvidence is proof of real money received. An entry can be
    // "active" with "none" evidence. Graduating into a real Financial
    // Foundation incomeSources row requires earningsEvidence to be at
    // least "repeatedSelfReported" — enforced in the mutation, never
    // derived from status alone.
    earningsEvidence: v.union(
      v.literal("none"),
      v.literal("selfReportedFirstPayment"),
      v.literal("repeatedSelfReported"),
      v.literal("confirmedViaDocumentIntelligence"),
    ),
    // Job-specific — only meaningful when kind === "job"; enforced by
    // mutation-level checks, not by this optionality alone.
    typeOfWork: v.optional(v.string()),
    hoursPerWeek: v.optional(v.number()),
    availabilityWindow: v.optional(v.string()),
    rateKnown: v.optional(v.boolean()),
    rateMinorUnitsPerHour: v.optional(v.number()),
    targetAmountMinorUnits: v.optional(v.number()),
    calcMode: v.optional(v.union(v.literal("timeFirst"), v.literal("incomeFirst"))),
    // Location matters — someone open to offline/local work needs real,
    // location-scoped results, not a generic "India"-wide search.
    // Never guessed: only used to narrow the search when explicitly set.
    workLocationPreference: v.optional(v.union(v.literal("online"), v.literal("offline"), v.literal("either"))),
    location: v.optional(v.string()), // city/area — only meaningful when workLocationPreference isn't "online"
    // Business-specific — only meaningful when kind === "business"; same
    // enforcement note as above.
    ideaDescription: v.optional(v.string()),
    startupCapitalMinorUnits: v.optional(v.number()),
    effortHoursPerWeek: v.optional(v.number()),
    rampUpMonths: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_kind", ["householdId", "kind"]),

  sideIncomeOpportunities: defineTable({
    householdId: v.id("households"),
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
    title: v.string(),
    mode: v.union(v.literal("online"), v.literal("offline")),
    fitHoursPerWeek: v.number(),
    estimateLowMinorUnits: v.number(),
    estimateHighMinorUnits: v.number(),
    isRoughEstimate: v.boolean(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")), // Loan & Debt's Firecrawl pattern
    inputStateRevision: v.number(),
    createdAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_entry", ["sideIncomeEntryId"]),

  sideIncomeCombinedPlans: defineTable({
    householdId: v.id("households"),
    opportunityIds: v.array(v.id("sideIncomeOpportunities")),
    totalHoursPerWeek: v.number(),
    totalIncomeLowMinorUnits: v.number(),
    totalIncomeHighMinorUnits: v.number(),
    hasTimeConflict: v.boolean(),
    hasShortfallVsTarget: v.boolean(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  sideIncomeDeepDives: defineTable({
    householdId: v.id("households"),
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
    opportunityId: v.optional(v.id("sideIncomeOpportunities")),
    topic: v.union(
      // job
      v.literal("howToStart"),
      v.literal("whereToApply"),
      v.literal("challenges"),
      v.literal("resources"),
      v.literal("motivation"),
      v.literal("blogs"),
      // business
      v.literal("ideaViability"),
      v.literal("startupCapital"),
      v.literal("schemeEligibility"),
      v.literal("localViability"),
      v.literal("maturityPath"),
    ),
    result: v.any(),
    sourceSnapshotIds: v.array(v.id("sourceSnapshots")),
    inputStateRevision: v.number(),
    // Latest retrieval timestamp among the sources used. A cached row is
    // valid only if inputStateRevision matches current AND now - this <
    // 24h — same threshold Loan & Debt uses for its rate snapshot.
    sourceSnapshotFreshAt: v.number(),
    createdAt: v.number(),
  }).index("by_household_entry_topic", ["householdId", "sideIncomeEntryId", "topic"]),

  sideIncomeAskSessions: defineTable({
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    // The two questions are fixed multiple-choice in the UI; the
    // mutation validates each answer against that fixed choice set.
    // Stored as strings (the chosen option's key) rather than schema
    // -level literals so question wording can change without a migration.
    question1Answer: v.string(),
    question2Answer: v.string(),
    generatedPlanText: v.string(),
    depthLevel: v.number(), // 1-6, cosmetic tiering only — no paywall enforcement
    createdAt: v.number(),
  })
    .index("by_entry", ["sideIncomeEntryId"])
    .index("by_household", ["householdId"]),

  schemeEligibilityChecks: defineTable({
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    // Gender/state/incomeSlab are deliberately NOT fields here. They're
    // collected in the UI for one search/matching call and discarded —
    // never written to any table.
    matchedSchemes: v.array(
      v.object({
        name: v.string(),
        sourceUrl: v.string(),
        retrievedAt: v.number(),
        note: v.string(), // e.g. "possibly eligible — verify these conditions", never "confirmed"
      }),
    ),
    checkedAt: v.number(),
  })
    .index("by_entry", ["sideIncomeEntryId"])
    .index("by_household", ["householdId"]),

  // Generic across every service, not just Side-Income — sourceService
  // names which service is asking ("sideIncome" | "investment" | future
  // services) and sourceEntityId is that service's own record id, stored
  // as a plain string since it can point to different tables. No
  // schema-level foreign key is possible across arbitrary tables, so
  // ownership of the referenced entity is NOT re-verified here — this
  // table only logs interest (never exposes or grants access to data),
  // and every insert is already scoped to the caller's own household via
  // requireMembership.
  humanConsultRequests: defineTable({
    householdId: v.id("households"),
    sourceService: v.string(),
    sourceEntityId: v.string(),
    topic: v.string(),
    // Fixed literal, not a union — this hackathon only ever logs
    // interest; there's no real scheduling process, so
    // "scheduled"/"completed" can't even be written.
    status: v.literal("interest_logged"),
    requestedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_source", ["sourceService", "sourceEntityId"]),

  // ===================================================================
  // INVESTMENT & RISK PLANNING (Service #6). Strictest AI boundary yet:
  // every number is pulled from the household's own existing data, pure
  // deterministic arithmetic, or a raw sourced reference — never an
  // invented return rate, tax slab, or readiness verdict, and never a
  // specific product recommendation. Reuses sourceRegistry/
  // sourceSnapshots (defined above) for every Firecrawl-backed piece.
  // ===================================================================

  investmentReadinessChecks: defineTable({
    householdId: v.id("households"),
    eligibleLiquidReserveMinorUnits: v.number(),
    emergencyReserveTargetMinorUnits: v.number(),
    earmarkedForGoalsMinorUnits: v.number(),
    investableSurplusMinorUnits: v.number(), // reserve − target − earmarked, deterministic
    existingEmiTotalMinorUnits: v.number(),
    activeGoalCount: v.number(),
    readinessState: v.union(
      v.literal("NO_SURPLUS_YET"),
      v.literal("LIMITED_CAPACITY"),
      v.literal("MODERATE_CAPACITY"),
      v.literal("STRONG_CAPACITY"),
      v.literal("INSUFFICIENT_DATA"),
    ),
    narration: v.optional(
      v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    ),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  investmentScenarios: defineTable({
    householdId: v.id("households"),
    timelineId: v.optional(v.id("timelines")),
    monthlyContributionMinorUnits: v.number(),
    horizonYears: v.number(),
    assumedAnnualReturnRangeLow: v.number(), // percent, e.g. 8 for 8%
    assumedAnnualReturnRangeHigh: v.number(),
    assumptionSourceNote: v.string(), // where this range came from, or "placeholder — no source found"
    assumptionSourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    projectedRangeLowMinorUnits: v.number(),
    projectedRangeHighMinorUnits: v.number(),
    narration: v.optional(
      v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    ),
    inputHash: v.string(), // contribution/horizon/timeline are user-varied — needs a real cache key
    inputStateRevision: v.number(),
    createdAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_timeline", ["householdId", "timelineId"]),

  // Deliberately a separable module (convex/taxBracket.ts) — Tax
  // Planning (Service #8) will import its lookup function directly
  // rather than reimplementing slab parsing.
  taxBracketEstimates: defineTable({
    householdId: v.id("households"),
    annualIncomeMinorUnits: v.number(),
    estimatedSlabLabel: v.string(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    narration: v.optional(v.object({ headline: v.string(), plainLanguage: v.string() })),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // NOT household-scoped — shared, general, non-product-specific
  // reference data, same pattern as sourceRegistry/sourceSnapshots.
  assetCategoryReferences: defineTable({
    category: v.union(
      v.literal("fixedDeposit"),
      v.literal("governmentBond"),
      v.literal("indexFund"),
      v.literal("mutualFund"),
      v.literal("ppf"),
      v.literal("gold"),
    ),
    description: v.string(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    fetchedAt: v.number(), // 30-day staleness window — reused, longer than loan-rate/side-income windows
  }).index("by_category", ["category"]),

  // ===================================================================
  // INSURANCE, PROTECTION & FINANCIAL RIGHTS (Service #7). Same
  // strictest-boundary discipline as Investment: every number is either
  // pulled from the household's own existing data (insurancePolicies,
  // obligations, incomeSources, timelineFamilySupport) or pure
  // deterministic arithmetic over it. OpenAI only narrates an
  // ALREADY-DECIDED gap/state/step list — it never invents a coverage-
  // need figure, decides whether a gap exists, or names a specific
  // insurer/product/premium. Reuses sourceRegistry/sourceSnapshots for
  // every Firecrawl-backed piece, same as every other service.
  // ===================================================================

  // NOT household-scoped — shared, general, non-product-specific
  // reference data, same pattern as assetCategoryReferences.
  insuranceCategoryReferences: defineTable({
    category: v.union(
      v.literal("life"),
      v.literal("health"),
      v.literal("motor"),
      v.literal("property"),
      v.literal("personalAccident"),
      v.literal("other"),
    ),
    description: v.string(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    fetchedAt: v.number(), // 30-day staleness window — same as assetCategoryReferences
  }).index("by_category", ["category"]),

  // Cached adequacy verdict. Every input field is captured on the row
  // (not just the outputs) so the row is self-explaining and reusable
  // for "email me a summary" without re-deriving anything.
  insuranceAdequacyChecks: defineTable({
    householdId: v.id("households"),
    totalLifeCoverageMinorUnits: v.number(),
    totalHealthCoverageMinorUnits: v.number(),
    // Proxy, not a literal headcount — see diagnoseAdequacy's comment in
    // convex/insuranceRiskPlanning.ts: count of timelineFamilySupport
    // rows across the household's CONFIRMED timelines.
    dependentsCount: v.number(),
    outstandingLoanBalanceMinorUnits: v.number(),
    bundledLifeCoverageMinorUnits: v.number(), // sum of obligations.bundledInsuranceCoverageMinorUnits
    dependableMonthlyIncome: v.number(),
    estimatedLifeCoverNeededMinorUnits: v.number(), // outstandingLoanBalance + 10 × dependableAnnualIncome
    lifeCoverageGapMinorUnits: v.number(), // needed − (total + bundled); negative = surplus
    healthCoverageAssessment: v.union(
      v.literal("NONE"),
      v.literal("LIKELY_INSUFFICIENT"),
      v.literal("LIKELY_ADEQUATE"),
      v.literal("INSUFFICIENT_DATA"),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // NOT household-scoped — shared, sourced regulatory-process reference
  // data. insuranceType is a free string (not the insurancePolicies
  // type union) since portability guidance may cover types beyond that
  // enum later without a schema change.
  insurancePortabilityGuides: defineTable({
    insuranceType: v.string(), // e.g. "health" — the type this guide applies to
    steps: v.array(v.object({ title: v.string(), detail: v.string() })),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    fetchedAt: v.number(), // 90-day staleness window — regulatory process pages change rarely
  }).index("by_type", ["insuranceType"]),

  // Cached, cross-service gap findings. Pure deterministic detection
  // (see detectGaps) — OpenAI only narrates which gaps were already found.
  insuranceGapDetections: defineTable({
    householdId: v.id("households"),
    gaps: v.array(
      v.object({
        gapType: v.string(), // e.g. "noLifeCoverWithDebt", "noHealthCoverSoleEarner", "businessWithoutLiabilityConsidered"
        description: v.string(),
        severity: v.union(v.literal("notable"), v.literal("significant")),
      }),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // ===================================================================
  // TAX PLANNING (Service #8). Reuses convex/taxBracket.ts's exported
  // lookupTaxSlab/TaxSlab (never duplicated) for the actual slab-
  // threshold lookup; that module only ever parsed the New Regime
  // column, so Old Regime slab parsing and full progressive-tax
  // computation are new, separate logic added here — not a
  // reimplementation of what taxBracket.ts already does. GST
  // (gstRegistered on taxProfiles) is informational only and never
  // feeds any calculation in this file or anywhere else.
  // ===================================================================

  taxProfiles: defineTable({
    householdId: v.id("households"),
    employmentType: v.union(v.literal("salaried"), v.literal("selfEmployed")),
    approximateTdsDeductedMinorUnits: v.optional(v.number()), // salaried only
    hraClaimedMinorUnits: v.optional(v.number()), // salaried only
    approximateNetBusinessIncomeMinorUnits: v.optional(v.number()), // self-employed only — ANNUAL net income, not revenue
    // Honest direct input — no household-scoped record of actual 80C
    // holdings (PPF/ELSS/etc.) exists anywhere else in the app;
    // assetCategoryReferences is shared education content, not a
    // per-household ledger.
    approximate80CInvestmentMinorUnits: v.optional(v.number()),
    gstRegistered: v.optional(v.boolean()), // informational only — never read by any calculation
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
  }).index("by_household", ["householdId"]),

  // Represents OLD-REGIME-ELIGIBLE deductions specifically — under
  // current law the new regime disallows nearly all of HRA/80C/80D/
  // 24(b) and uses its own separate standard deduction, so a single
  // combined total can't represent both regimes. The new-regime side
  // of taxRegimeComparisons computes its own taxable income separately.
  taxDeductionSummaries: defineTable({
    householdId: v.id("households"),
    loanInterestDeductionMinorUnits: v.number(), // Sec 24(b) — homeLoan obligations, capped at the real sourced limit
    insurancePremiumDeductionMinorUnits: v.number(), // Sec 80D — health-type insurancePolicies only, capped
    investmentDeductionMinorUnits: v.number(), // Sec 80C — life-type policy premiums + approximate80CInvestmentMinorUnits, capped
    standardDeductionMinorUnits: v.number(), // fixed, sourced, old-regime figure — salaried only, 0 for self-employed
    totalDeductionsMinorUnits: v.number(),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  taxRegimeComparisons: defineTable({
    householdId: v.id("households"),
    oldRegimeEstimatedTaxMinorUnits: v.number(),
    newRegimeEstimatedTaxMinorUnits: v.number(),
    recommendedRegime: v.union(v.literal("old"), v.literal("new"), v.literal("similar")), // "similar" within ₹1,000
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputHash: v.string(), // employmentType + income + deduction inputs vary per household — real cache key needed
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  taxDeductionGaps: defineTable({
    householdId: v.id("households"),
    gaps: v.array(
      v.object({
        gapType: v.string(), // e.g. "unclaimedInsuranceDeduction", "unclaimedInvestmentDeduction", "noProfileSet"
        description: v.string(),
        estimatedMissedDeductionMinorUnits: v.optional(v.number()),
      }),
    ),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    inputStateRevision: v.number(),
    createdAt: v.number(),
  }).index("by_household", ["householdId"]),

  // NOT household-scoped — shared reference data, same pattern as
  // assetCategoryReferences/insuranceCategoryReferences. Deliberately
  // light: 1-2 real items only, never a full news/intelligence feed —
  // that's explicitly deferred to Government, Economic & Livelihood
  // Intelligence.
  taxEconomicContextItems: defineTable({
    title: v.string(),
    description: v.string(),
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    sourceUrl: v.string(),
    sourceLabel: v.string(),
    fetchedAt: v.number(), // 30+ day staleness window — doesn't need to be live-fresh
  }).index("by_fetchedAt", ["fetchedAt"]),

  // ===================================================================
  // GOVERNMENT, ECONOMIC & LIVELIHOOD INTELLIGENCE (Service #9).
  // Structurally different from every prior service: PUSH (a cron
  // monitors real sources and alerts the household when something
  // material changes), with a light PULL layer (profile + findings
  // feed) on top. Two tracks: "job" (salaried work — rate/sector/
  // inflation signals) and "business" (ACTIVE/graduated Side-Income
  // entries only — rate/sector/scheme/regulatory signals). Reuses
  // sourceRegistry/sourceSnapshots for every Firecrawl-backed piece and
  // humanConsultRequests (sourceService: "governmentEconomic").
  // ===================================================================

  livelihoodProfiles: defineTable({
    householdId: v.id("households"),
    track: v.union(v.literal("job"), v.literal("business")),
    freeTextDescription: v.string(),
    source: v.union(
      v.literal("userProvided"),
      v.literal("prefilledFromIncomeSource"),
      v.literal("prefilledFromSideIncome"),
    ),
    // Job track — AI-EXTRACTED from freeTextDescription (extraction,
    // same pattern as Document Intelligence — never a calculation).
    interpretedOccupation: v.optional(v.string()),
    interpretedSector: v.optional(v.string()),
    interpretedState: v.optional(v.string()),
    // Business track — one row per active/graduated Side-Income entry.
    sideIncomeEntryId: v.optional(v.id("sideIncomeEntries")),
    interpretedBusinessType: v.optional(v.string()),
    interpretedApproxIncomeMinorUnits: v.optional(v.number()),
    // Deterministic — computed in code, never by the model.
    missingFields: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_track", ["householdId", "track"])
    .index("by_sideIncomeEntry", ["sideIncomeEntryId"]),

  economicFindings: defineTable({
    householdId: v.id("households"),
    track: v.union(v.literal("job"), v.literal("business")),
    findingType: v.union(
      v.literal("interestRate"),
      v.literal("sectorRisk"),
      v.literal("scheme"),
      v.literal("regulatory"),
    ),
    // Deterministic per-findingType threshold — see governmentEconomic.ts.
    severity: v.union(v.literal("notable"), v.literal("significant")),
    title: v.string(),
    headline: v.string(), // deterministic, factual
    body: v.optional(v.string()),
    steps: v.optional(v.array(v.string())), // findingType decides which is populated
    affectsService: v.string(), // "loanDebt" | "sideIncome" | "financialFoundation" | "goalPlanning"
    affectsEntityId: v.optional(v.string()),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    sourceSnapshotId: v.id("sourceSnapshots"), // required — a finding only exists because of a real scrape
    generatedAt: v.number(),
    emailSent: v.boolean(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_track", ["householdId", "track"])
    .index("by_household_generatedAt", ["householdId", "generatedAt"]),

  economicFindingDeepDives: defineTable({
    householdId: v.id("households"),
    findingId: v.id("economicFindings"),
    result: v.any(),
    sourceSnapshotIds: v.array(v.id("sourceSnapshots")),
    fetchedAt: v.number(),
    createdAt: v.number(),
  }).index("by_household_finding", ["householdId", "findingId"]),

  economicMonitoringState: defineTable({
    householdId: v.id("households"),
    track: v.union(v.literal("job"), v.literal("business")),
    signalType: v.string(), // "referenceRate" | "sectorRisk:<sector>" | "scheme:<entryId>:<businessType>" | "regulatory:<entryId>:<businessType>"
    lastKnownValue: v.any(),
    lastCheckedAt: v.number(),
  }).index("by_household_track_signal", ["householdId", "track", "signalType"]),

  // ===================================================================
  // INCOME RESILIENCE (Service #10). Cross-service synthesis, not a new
  // domain of its own — reads live from Financial Foundation, Loan &
  // Debt, Insurance, Side-Income, Investment, and Government/Economic
  // Intelligence, and is otherwise fully reactive (no save button, no
  // stored computation for the interactive view). These two tables
  // exist only for what genuinely needs persistence: a real, sourced
  // benchmark (not hardcoded from training data), and a snapshot
  // written ONLY when the household's tier actually changes, so the
  // proactive alert (piggybacking on the existing daily cron) has a
  // real "last known tier" to compare against and a trend line can be
  // shown honestly.
  // ===================================================================

  incomeResilienceSnapshots: defineTable({
    householdId: v.id("households"),
    tier: v.union(v.literal("resilient"), v.literal("worthALook"), v.literal("atRisk")),
    incomeConcentrationPercent: v.number(),
    runwayMonths: v.number(),
    emiToIncomeRatioPercent: v.number(),
    hasBreachedObligation: v.boolean(),
    hasIncomeProtectionInsurance: v.boolean(),
    liquidInvestmentsMinorUnits: v.number(),
    hasBackupIncomeInProgress: v.boolean(),
    hasRecentSignificantEconomicFinding: v.boolean(),
    weakDimensions: v.array(v.string()),
    narration: v.object({ headline: v.string(), plainLanguage: v.string(), caveats: v.array(v.string()) }),
    emailSent: v.boolean(),
    generatedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_household_generatedAt", ["householdId", "generatedAt"]),

  // NOT household-scoped — shared reference data, same pattern as
  // taxEconomicContextItems/assetCategoryReferences. One real, sourced
  // benchmark (e.g. recommended emergency-fund coverage), never a
  // hardcoded "6 months" rule of thumb from training data.
  incomeResilienceBenchmarks: defineTable({
    label: v.string(),
    description: v.string(),
    recommendedMonths: v.optional(v.number()), // deterministically parsed (regex) from the real source, never AI-guessed
    sourceSnapshotId: v.optional(v.id("sourceSnapshots")),
    sourceUrl: v.string(),
    sourceLabel: v.string(),
    fetchedAt: v.number(),
  }).index("by_fetchedAt", ["fetchedAt"]),

  // One living note per household — overwritten on each save, not a
  // log. The one thing Income Resilience can't see from structured
  // data alone (worried about layoffs, a health issue, a dependent, a
  // life event coming up). interpretedConcernCategory is AI-EXTRACTED
  // from the free text (same extraction-only boundary as Document
  // Intelligence / Government Economic Intelligence's livelihood
  // profiles) — it never changes the deterministic tier or weak
  // -dimension list, only adds honest context to the narration, read by
  // both the on-demand check and the weekly cron sweep.
  incomeResilienceNotes: defineTable({
    householdId: v.id("households"),
    freeText: v.string(),
    interpretedConcernCategory: v.optional(
      v.union(
        v.literal("jobSecurity"),
        v.literal("healthOrDependent"),
        v.literal("majorLifeEvent"),
        v.literal("businessConcern"),
        v.literal("none"),
      ),
    ),
    updatedAt: v.number(),
  }).index("by_household", ["householdId"]),

  // Deploy tooling, not app data — no PII, not household-scoped. Maps a
  // request path (e.g. "/index.html", "/assets/index-XkLXvLKj.css") to
  // the Convex file-storage blob for that built frontend asset, so
  // convex/http.ts's catch-all route can serve the real Vite build
  // directly from this deployment's own *.convex.site domain. Wiped
  // and rewritten in full on every static-site deploy (see
  // scripts/deploy-static-site.mjs) — never partially patched, so a
  // deploy can't leave a stale mix of old and new files.
  staticAssets: defineTable({
    path: v.string(),
    storageId: v.id("_storage"),
    contentType: v.string(),
  }).index("by_path", ["path"]),
});

// =====================================================================
// Deferred on purpose (agreed across both reviews): domain-specific
// tables for Loan/Tax/Insurance/Investment/SideIncome/Employment/
// GovernmentPrograms/Rights — added when each service is built, on
// top of this shared Reasoning/Memory/Evidence layer.
//
// Enforcement rules that live in MUTATION CODE, not the schema itself:
// - Number.isInteger(amountMinorUnits) on every write to a money field
// - households.stateRevision increments ONLY for decision-affecting
//   changes (income/expense/obligation/goal/situation/confirmed-fact
//   edits) — never for notification-read status, UI prefs, or similar
// =====================================================================
