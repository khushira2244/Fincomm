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
  | { name: "sideIncome" };

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
        parsed.name === "sideIncome"
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
      <>
        <Header />
        <div style={{ padding: "24px", color: colors.inkSoft }}>Loading…</div>
      </>
    );
  }

  if (mine === null) {
    return (
      <>
        <Header />
        <EmptyState
          heading="Start your financial foundation"
          subtext="Add your income, expenses, loans, and savings — this becomes the foundation everything else is calculated from."
          buttonLabel="Add financial details"
          onAction={() => void ensureHousehold()}
        />
      </>
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
          : "goalPlanning";

  return (
    <div style={{ display: "flex" }}>
      <Sidebar
        activeKey={activeKey}
        onNavigate={(key) =>
          setRoute(
            key === "financialFoundation"
              ? { name: "financialFoundation" }
              : key === "loanDebt"
                ? { name: "loanDebt" }
                : key === "sideIncome"
                  ? { name: "sideIncome" }
                  : { name: "goalPlanningOverview" },
          )
        }
      />
      {route.name === "financialFoundation" && <FinancialFoundationScreen />}
      {route.name === "loanDebt" && <LoanDebtScreen />}
      {route.name === "sideIncome" && <SideIncomeScreen />}
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
  );
}
