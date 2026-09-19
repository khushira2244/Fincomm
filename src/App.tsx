"use client";

import { useEffect, useState } from "react";
import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { AuthScreen } from "./components/AuthScreen";
import { Header } from "./components/Header";
import { Sidebar, ServiceKey } from "./components/Sidebar";
import { EmptyState } from "./components/EmptyState";
import { FinancialFoundationScreen } from "./components/FinancialFoundationScreen";
import { TimelineOverviewScreen } from "./components/goalPlanning/TimelineOverviewScreen";
import { TimelineDetailScreen } from "./components/goalPlanning/TimelineDetailScreen";
import { PlanAnalysisScreen } from "./components/goalPlanning/PlanAnalysisScreen";
import { LoanDebtScreen } from "./components/loanDebt/LoanDebtScreen";
import { SideIncomeScreen } from "./components/sideIncome/SideIncomeScreen";
import { InvestmentScreen } from "./components/investment/InvestmentScreen";
import { InsuranceScreen } from "./components/insurance/InsuranceScreen";
import { TaxPlanningScreen } from "./components/tax/TaxPlanningScreen";
import { GovernmentEconomicScreen } from "./components/governmentEconomic/GovernmentEconomicScreen";
import { IncomeResilienceScreen } from "./components/incomeResilience/IncomeResilienceScreen";
import { colors, fontSans } from "./theme";

// FinComp — see the components/ folder for each piece. Financial
// Foundation's own files (screens, mutations, queries, runway) are
// unchanged; this file just routes between services.

export default function App() {
  return (
    <div style={{ minHeight: "100vh", background: colors.cream, fontFamily: fontSans }}>
      <AuthLoading>
        <div style={{ padding: "24px", color: colors.inkSoft }}>Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <AuthenticatedApp />
      </Authenticated>
    </div>
  );
}

type Route =
  | { name: "financialFoundation" }
  | { name: "goalPlanningOverview" }
  | { name: "goalPlanningDetail"; timelineId: Id<"timelines"> }
  | { name: "planAnalysis" }
  | { name: "loanDebt" }
  | { name: "sideIncome" }
  | { name: "investment" }
  | { name: "insurance" }
  | { name: "tax" }
  | { name: "governmentEconomic" }
  | { name: "incomeResilience" };

// Shared by Sidebar's onNavigate and any screen that routes into
// another service directly (e.g. Income Resilience's "fix this in X"
// links) — one place for the ServiceKey -> Route mapping.
function serviceKeyToRoute(key: ServiceKey): Route {
  switch (key) {
    case "financialFoundation":
      return { name: "financialFoundation" };
    case "loanDebt":
      return { name: "loanDebt" };
    case "sideIncome":
      return { name: "sideIncome" };
    case "investment":
      return { name: "investment" };
    case "insurance":
      return { name: "insurance" };
    case "tax":
      return { name: "tax" };
    case "governmentEconomic":
      return { name: "governmentEconomic" };
    case "incomeResilience":
      return { name: "incomeResilience" };
    default:
      return { name: "goalPlanningOverview" };
  }
}

const ROUTE_STORAGE_KEY = "finComp:route";

function loadRoute(): Route {
  try {
    const raw = localStorage.getItem(ROUTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Route;
      if (
        parsed.name === "financialFoundation" ||
        parsed.name === "goalPlanningOverview" ||
        parsed.name === "goalPlanningDetail" ||
        parsed.name === "planAnalysis" ||
        parsed.name === "loanDebt" ||
        parsed.name === "sideIncome" ||
        parsed.name === "investment" ||
        parsed.name === "insurance" ||
        parsed.name === "tax" ||
        parsed.name === "governmentEconomic" ||
        parsed.name === "incomeResilience"
      ) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return { name: "financialFoundation" };
}

function AuthenticatedApp() {
  const mine = useQuery(api.households.getMine);
  const ensureHousehold = useMutation(api.households.ensureHousehold);
  const [route, setRoute] = useState<Route>(loadRoute);

  useEffect(() => {
    try {
      localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(route));
    } catch {
      /* ignore */
    }
  }, [route]);

  if (mine === undefined) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header />
        <div style={{ padding: "24px", color: colors.inkSoft }}>Loading…</div>
      </div>
    );
  }

  if (mine === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header />
        <EmptyState
          heading="Start your financial foundation"
          subtext="Add your income, expenses, loans, and savings — this becomes the foundation everything else is calculated from."
          buttonLabel="Add financial details"
          onAction={() => void ensureHousehold()}
        />
      </div>
    );
  }

  const householdId = mine.household._id;
  const activeKey: ServiceKey =
    route.name === "financialFoundation"
      ? "financialFoundation"
      : route.name === "loanDebt"
        ? "loanDebt"
        : route.name === "sideIncome"
          ? "sideIncome"
          : route.name === "investment"
            ? "investment"
            : route.name === "insurance"
              ? "insurance"
              : route.name === "tax"
                ? "tax"
                : route.name === "governmentEconomic"
                  ? "governmentEconomic"
                  : route.name === "incomeResilience"
                    ? "incomeResilience"
                    : "goalPlanning";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <Header />
      <div style={{ display: "flex", flex: 1 }}>
      <Sidebar activeKey={activeKey} onNavigate={(key) => setRoute(serviceKeyToRoute(key))} />
      {route.name === "financialFoundation" && <FinancialFoundationScreen />}
      {route.name === "loanDebt" && <LoanDebtScreen />}
      {route.name === "sideIncome" && <SideIncomeScreen />}
      {route.name === "investment" && <InvestmentScreen />}
      {route.name === "insurance" && (
        <InsuranceScreen onNavigateToFinancialFoundation={() => setRoute({ name: "financialFoundation" })} />
      )}
      {route.name === "tax" && <TaxPlanningScreen />}
      {route.name === "governmentEconomic" && <GovernmentEconomicScreen />}
      {route.name === "incomeResilience" && <IncomeResilienceScreen onNavigate={(key) => setRoute(serviceKeyToRoute(key))} />}
      {route.name === "goalPlanningOverview" && (
        <TimelineOverviewScreen
          householdId={householdId}
          onOpenTimeline={(timelineId) => setRoute({ name: "goalPlanningDetail", timelineId })}
        />
      )}
      {route.name === "goalPlanningDetail" && (
        <TimelineDetailScreen
          householdId={householdId}
          timelineId={route.timelineId}
          onBack={() => setRoute({ name: "goalPlanningOverview" })}
          onAnalysisReady={() => setRoute({ name: "planAnalysis" })}
        />
      )}
      {route.name === "planAnalysis" && (
        <PlanAnalysisScreen
          onBack={() => setRoute({ name: "goalPlanningOverview" })}
          onOpenTimeline={(timelineId) => setRoute({ name: "goalPlanningDetail", timelineId })}
        />
      )}
      </div>
    </div>
  );
}
