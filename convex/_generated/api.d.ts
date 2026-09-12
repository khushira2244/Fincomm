/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as assets from "../assets.js";
import type * as auth from "../auth.js";
import type * as documentIntelligence from "../documentIntelligence.js";
import type * as email from "../email.js";
import type * as expenses from "../expenses.js";
import type * as extractedFacts from "../extractedFacts.js";
import type * as goalPlanning from "../goalPlanning.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as incomeSources from "../incomeSources.js";
import type * as loanDebt from "../loanDebt.js";
import type * as obligations from "../obligations.js";
import type * as planAnalysis from "../planAnalysis.js";
import type * as runway from "../runway.js";
import type * as sideIncome from "../sideIncome.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  assets: typeof assets;
  auth: typeof auth;
  documentIntelligence: typeof documentIntelligence;
  email: typeof email;
  expenses: typeof expenses;
  extractedFacts: typeof extractedFacts;
  goalPlanning: typeof goalPlanning;
  households: typeof households;
  http: typeof http;
  incomeSources: typeof incomeSources;
  loanDebt: typeof loanDebt;
  obligations: typeof obligations;
  planAnalysis: typeof planAnalysis;
  runway: typeof runway;
  sideIncome: typeof sideIncome;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
};
