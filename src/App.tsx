"use client";

import { Authenticated, AuthLoading, Unauthenticated, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AuthScreen } from "./components/AuthScreen";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { EmptyState } from "./components/EmptyState";
import { FinancialFoundationScreen } from "./components/FinancialFoundationScreen";
import { colors, fontSans } from "./theme";

// FinComp — see the components/ folder for each piece. All data logic
// (mutations, queries, schema, the runway calculation) is unchanged from
// the previous build; this file only decides which screen to show.

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

function AuthenticatedApp() {
  const mine = useQuery(api.households.getMine);
  const ensureHousehold = useMutation(api.households.ensureHousehold);

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

  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <FinancialFoundationScreen />
    </div>
  );
}
