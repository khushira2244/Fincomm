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

  humanConsultRequests: defineTable({
    householdId: v.id("households"),
    sideIncomeEntryId: v.id("sideIncomeEntries"),
    topic: v.string(),
    // Fixed literal, not a union — this hackathon only ever logs
    // interest; there's no real scheduling process, so
    // "scheduled"/"completed" can't even be written.
    status: v.literal("interest_logged"),
    requestedAt: v.number(),
  })
    .index("by_household", ["householdId"])
    .index("by_entry", ["sideIncomeEntryId"]),
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
