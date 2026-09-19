import { FormEvent, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Logo } from "./Logo";
import { colors, fontSans, fontSerif, radius } from "../theme";

// Sign-in/sign-up logic (describeSignInError, SignInForm's own submit
// handling) is unchanged — only the surrounding landing-page layout is
// new. Two views: the marketing landing page (default), and the actual
// sign-in/sign-up form, reached via any of the "Sign in" / "Sign up" /
// "Get started" entry points.

// @convex-dev/auth's Password provider throws its internal result codes
// almost verbatim (e.g. "InvalidAccountId", "InvalidSecret",
// "TooManyFailedAttempts") wrapped in a generic Convex server-error
// message, rather than a message meant for end users. Map the codes we
// know about to plain language; fall back to the raw message otherwise.
function describeSignInError(err: Error, flow: "signIn" | "signUp"): string {
  const message = err.message;
  if (message.includes("InvalidAccountId")) {
    return flow === "signIn"
      ? "No account found with this email. Try signing up instead."
      : "Something went wrong creating that account. Please try again.";
  }
  if (message.includes("InvalidSecret")) {
    return "Incorrect password.";
  }
  if (message.includes("TooManyFailedAttempts")) {
    return "Too many failed attempts. Please wait a bit and try again.";
  }
  if (message.includes("already exists")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  return message;
}

const SERVICES: { title: string; description: string }[] = [
  { title: "Financial Foundation", description: "See your real numbers — income, expenses, loans, and how long your reserves would last." },
  { title: "Goal & Situation Planning", description: "Plan across years, not just today — and see how your plans interact." },
  { title: "Loan & Debt Resilience", description: "Know if a loan actually fits, and how to pay it off faster." },
  { title: "Side-Income & Business", description: "Explore a job or business idea that realistically fits your time and money." },
  { title: "Investment & Risk", description: "Understand what you can afford to set aside — never what to buy." },
  { title: "Insurance & Protection", description: "Know what you're covered for, and where you might be exposed." },
  { title: "Tax Planning", description: "See your deductions and compare regimes — no filing, just clarity." },
  { title: "Government & Economic Intelligence", description: "We watch for real changes that could affect your job, business, or plans." },
  { title: "Income Resilience", description: "The full picture — how exposed your household really is, and what to do about it." },
];

export function AuthScreen() {
  const [formFlow, setFormFlow] = useState<"signIn" | "signUp" | null>(null);

  if (formFlow) {
    return <SignInFormScreen initialFlow={formFlow} onBack={() => setFormFlow(null)} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: colors.cream, fontFamily: fontSans }}>
      <nav
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 32px",
          borderBottom: `1px solid ${colors.sageGreen}`,
        }}
      >
        <Logo dark wordmarkSize={20} />
        <div style={{ display: "flex", gap: "10px" }}>
          <button style={navGhostButtonStyle} onClick={() => setFormFlow("signIn")}>
            Sign in
          </button>
          <button style={navPrimaryButtonStyle} onClick={() => setFormFlow("signUp")}>
            Sign up
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "64px 24px 24px", textAlign: "center" }}>
        <h1 style={{ fontFamily: fontSerif, fontStyle: "italic", fontSize: "34px", lineHeight: 1.35, margin: "0 0 16px", color: colors.ink }}>
          &ldquo;One place to see what a decision really means for your household.&rdquo;
        </h1>
        <p style={{ fontSize: "15px", color: colors.inkSoft, maxWidth: "600px", margin: "0 auto 28px" }}>
          Financial Foundation, goals, loans, income, insurance, tax, and more — connected, not scattered across apps.
        </p>
        <button style={heroButtonStyle} onClick={() => setFormFlow("signUp")}>
          Get started
        </button>
      </div>

      <div style={{ maxWidth: "920px", margin: "0 auto", padding: "48px 24px 64px" }}>
        <div style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.inkSoft, marginBottom: "20px" }}>
          What FinComp helps with
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px" }}>
          {SERVICES.map((s) => (
            <div
              key={s.title}
              style={{
                background: "#ffffff",
                border: `1px solid ${colors.sageGreen}`,
                borderRadius: radius,
                padding: "18px 20px",
                textAlign: "left",
              }}
            >
              <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", color: colors.deepGreen, marginBottom: "6px" }}>{s.title}</div>
              <div style={{ fontSize: "13px", color: colors.inkSoft, lineHeight: 1.45 }}>{s.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignInFormScreen({ initialFlow, onBack }: { initialFlow: "signIn" | "signUp"; onBack: () => void }) {
  return (
    <div style={{ minHeight: "100vh", background: colors.cream, fontFamily: fontSans, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 32px" }}>
        <Logo dark wordmarkSize={20} />
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}>
        <div style={{ width: "320px", maxWidth: "100%" }}>
          <span onClick={onBack} style={{ fontSize: "13px", color: colors.deepGreen, textDecoration: "underline", cursor: "pointer" }}>
            ← Back
          </span>
          <div style={{ marginTop: "16px" }}>
            <SignInForm initialFlow={initialFlow} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SignInForm({ initialFlow }: { initialFlow: "signIn" | "signUp" }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">(initialFlow);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "320px", maxWidth: "100%" }}>
      <h2 style={{ fontFamily: fontSerif, fontSize: "24px", margin: 0, color: colors.ink }}>
        {flow === "signIn" ? "Sign in" : "Sign up"}
      </h2>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          formData.set("flow", flow);
          void signIn("password", formData).catch((err: Error) => {
            setError(describeSignInError(err, flow));
          });
        }}
      >
        <label style={fieldLabelStyle}>
          Email
          <input style={inputStyle} type="email" name="email" placeholder="you@example.com" />
        </label>
        <label style={fieldLabelStyle}>
          Password
          <input style={inputStyle} type="password" name="password" placeholder="••••••••" />
        </label>
        <button style={buttonStyle} type="submit">
          {flow === "signIn" ? "Sign in" : "Sign up"}
        </button>
        <span style={{ fontFamily: fontSans, fontSize: "13px", color: colors.inkSoft, textAlign: "center" }}>
          {flow === "signIn" ? "Need an account? " : "Have an account? "}
          <span
            style={{ color: colors.deepGreen, textDecoration: "underline", cursor: "pointer" }}
            onClick={() => {
              setError(null);
              setFlow(flow === "signIn" ? "signUp" : "signIn");
            }}
          >
            {flow === "signIn" ? "Sign up" : "Sign in"}
          </span>
        </span>
        {error && <p style={{ fontFamily: fontSans, fontSize: "13px", color: "#a13d3d", margin: 0 }}>{error}</p>}
      </form>
    </div>
  );
}

const navGhostButtonStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "13px",
  background: "#ffffff",
  color: colors.deepGreen,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "8px 16px",
  cursor: "pointer",
};

const navPrimaryButtonStyle: React.CSSProperties = {
  ...navGhostButtonStyle,
  background: colors.deepGreen,
  color: colors.cream,
  border: `1px solid ${colors.deepGreen}`,
};

const heroButtonStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "14px",
  background: colors.deepGreen,
  color: colors.cream,
  border: "none",
  borderRadius: radius,
  padding: "12px 24px",
  cursor: "pointer",
};

const fieldLabelStyle = {
  fontFamily: fontSans,
  fontSize: "13px",
  color: colors.inkSoft,
  display: "flex",
  flexDirection: "column" as const,
  gap: "6px",
};

const inputStyle = {
  fontFamily: fontSans,
  fontSize: "14px",
  background: "#ffffff",
  color: colors.ink,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "10px 12px",
};

const buttonStyle = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "14px",
  background: colors.deepGreen,
  color: colors.cream,
  border: "none",
  borderRadius: radius,
  padding: "10px 16px",
  cursor: "pointer",
  marginTop: "4px",
};
