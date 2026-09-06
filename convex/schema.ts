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
    interestRateBasisPoints: v.number(),
    dueDayOfMonth: v.number(),
    penaltyPolicy: v.optional(v.string()),
    maturityDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdByMemberId: v.id("memberships"),
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
  }).index("by_household", ["householdId"]),

  situations: defineTable({
    householdId: v.id("households"),
    kind: v.union(v.literal("observed"), v.literal("planned"), v.literal("hypothetical")),
    description: v.string(),
    effectiveDate: v.number(),
    durationDays: v.optional(v.number()),
    affectedMemberIds: v.array(v.id("memberships")),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
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
