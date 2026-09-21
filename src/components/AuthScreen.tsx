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

const HOW_STEPS: { n: string; title: string; description: string }[] = [
  { n: "01", title: "Describe", description: "Tell it what happened — in your own words. A lost income source, a new loan, a job change." },
  { n: "02", title: "Extract", description: "AI pulls out the structured facts. It never invents a number — you confirm everything before it's real." },
  { n: "03", title: "Compute", description: "Plain, deterministic TypeScript runs the actual math — runway, EMI, tax, affordability. No AI in the arithmetic." },
  { n: "04", title: "Connect", description: "Every service that depends on this fact updates together — not nine separate tools that each need telling." },
];

const MECHANISM_CARDS: { name: string; eyebrow: string; description: string }[] = [
  { name: "Convex", eyebrow: "Backend & live state", description: "Every number you enter updates live, everywhere it's used — your runway, your loan checks, your plan." },
  { name: "Firecrawl", eyebrow: "Real, sourced data", description: "Actual RBI rates, IRDAI rules, and tax slabs — scraped, dated, and shown as context, not guessed." },
  { name: "OpenAI", eyebrow: "Explains, never decides", description: "Turns the real numbers into plain language — it narrates the math, it never invents it." },
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
          position: "sticky",
          top: 0,
          background: "rgba(246, 241, 228, 0.92)",
          backdropFilter: "blur(6px)",
          zIndex: 10,
        }}
      >
        <Logo dark wordmarkSize={20} />
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <div className="hidden sm:flex" style={{ gap: "24px" }}>
            <a href="#services" style={navLinkStyle} className="hover:opacity-70 transition-opacity">
              Services
            </a>
            <a href="#mechanism" style={navLinkStyle} className="hover:opacity-70 transition-opacity">
              How it's built
            </a>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              style={navGhostButtonStyle}
              className="hover:shadow-md transition-shadow"
              onClick={() => setFormFlow("signIn")}
            >
              Sign in
            </button>
            <button
              style={navPrimaryButtonStyle}
              className="hover:opacity-90 hover:shadow-md transition-all"
              onClick={() => setFormFlow("signUp")}
            >
              Sign up
            </button>
          </div>
        </div>
      </nav>

      <div
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${colors.sageGreen}33, transparent)`,
        }}
      >
        <div style={{ maxWidth: "920px", margin: "0 auto", padding: "72px 24px 32px", textAlign: "center" }}>
          <div style={eyebrowStyle}>FinComp</div>
          <h1 style={{ fontFamily: fontSerif, fontStyle: "italic", fontSize: "36px", lineHeight: 1.35, margin: "0 0 16px", color: colors.ink }}>
            &ldquo;One place to see what a decision really means for your household.&rdquo;
          </h1>
          <p style={{ fontSize: "15px", color: colors.inkSoft, maxWidth: "600px", margin: "0 auto 28px" }}>
            Financial Foundation, goals, loans, income, insurance, tax, and more — connected, not scattered across apps.
          </p>
          <button
            style={heroButtonStyle}
            className="hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5 transition-all"
            onClick={() => setFormFlow("signUp")}
          >
            Get started
          </button>
        </div>
      </div>

      <div id="services" style={{ maxWidth: "920px", margin: "0 auto", padding: "48px 24px 64px", scrollMarginTop: "80px" }}>
        <div style={eyebrowStyle}>What FinComp helps with</div>
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
              className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", color: colors.deepGreen, marginBottom: "6px" }}>{s.title}</div>
              <div style={{ fontSize: "13px", color: colors.inkSoft, lineHeight: 1.45 }}>{s.description}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: "980px", margin: "0 auto", padding: "16px 24px 64px" }}>
        <h2 style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "24px", margin: "0 0 12px", color: colors.ink }}>
          One record, checked four ways.
        </h2>
        <p style={{ fontSize: "14px", color: colors.inkSoft, lineHeight: 1.6, maxWidth: "620px", margin: "0 0 32px" }}>
          Every household starts as one shared record. Describe what changed, and FinComp turns it
          into real numbers, then lets every connected service react to the same confirmed fact —
          instead of re-entering the same information into nine separate tools.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) minmax(280px, 1.1fr)", gap: "40px", alignItems: "start" }} className="max-md:!grid-cols-1">
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {HOW_STEPS.map((step) => (
              <div key={step.n} style={{ display: "flex", gap: "16px" }}>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: colors.deepGreen,
                    background: colors.creamDim,
                    border: `1px solid ${colors.sageGreen}`,
                    borderRadius: "6px",
                    width: "30px",
                    height: "30px",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {step.n}
                </div>
                <div>
                  <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", color: colors.ink, marginBottom: "3px" }}>{step.title}</div>
                  <div style={{ fontSize: "13px", color: colors.inkSoft, lineHeight: 1.5 }}>{step.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              background: colors.deepGreen,
              borderRadius: radius,
              padding: "22px 24px",
              boxShadow: "0 8px 24px rgba(31, 74, 58, 0.18)",
            }}
            className="hover:shadow-lg transition-shadow duration-300"
          >
            <div style={{ fontFamily: "monospace", fontSize: "10px", letterSpacing: "0.08em", color: colors.sageGreen, marginBottom: "6px" }}>
              ONE HOUSEHOLD
            </div>
            <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "18px", color: colors.cream, marginBottom: "18px" }}>
              Financial Foundation
            </div>

            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.sageGreen, marginBottom: "10px" }}>
              Computed deterministically
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "18px" }}>
              {["Liquid savings", "Essential expenses", "Total EMI", "Dependable income"].map((field) => (
                <div
                  key={field}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "rgba(246, 241, 228, 0.08)",
                    border: `1px solid ${colors.midGreen}`,
                    borderRadius: "6px",
                    padding: "8px 10px",
                    fontSize: "12px",
                    color: colors.cream,
                  }}
                >
                  <span style={{ color: "#9ED6B5" }}>✓</span> {field}
                </div>
              ))}
            </div>

            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.sageGreen, marginBottom: "10px" }}>
              Explained by AI
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "rgba(246, 241, 228, 0.08)",
                border: `1px solid ${colors.midGreen}`,
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "12px",
                color: colors.sageGreen,
                marginBottom: "18px",
              }}
            >
              🔒 Plain-language narration — never the number itself
            </div>

            <div style={{ display: "flex", gap: "8px", borderTop: `1px solid ${colors.midGreen}`, paddingTop: "14px" }}>
              {["Runway", "Deep dive", "Confirm"].map((action) => (
                <div
                  key={action}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: colors.cream,
                    border: `1px solid ${colors.midGreen}`,
                    borderRadius: "6px",
                    padding: "8px 4px",
                  }}
                >
                  {action}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div id="mechanism" style={{ background: colors.creamDim, borderTop: `1px solid ${colors.sageGreen}`, scrollMarginTop: "64px" }}>
        <div style={{ maxWidth: "920px", margin: "0 auto", padding: "56px 24px 64px" }}>
          <div style={{ textAlign: "center", marginBottom: "36px" }}>
            <div style={eyebrowStyle}>The mechanism</div>
            <h2 style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "26px", margin: 0, color: colors.ink }}>
              One real number, checked from four directions.
            </h2>
          </div>

          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "16px", alignItems: "stretch" }}
          >
            {MECHANISM_CARDS.map((card, i) => (
              <div key={card.name} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    background: "#ffffff",
                    border: `1px solid ${colors.sageGreen}`,
                    borderRadius: radius,
                    padding: "18px 20px",
                    textAlign: "left",
                    flex: 1,
                  }}
                  className="hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", color: colors.deepGreen, marginBottom: "4px" }}>{card.name}</div>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.midGreen, marginBottom: "8px" }}>
                    {card.eyebrow}
                  </div>
                  <div style={{ fontSize: "13px", color: colors.inkSoft, lineHeight: 1.45 }}>{card.description}</div>
                </div>
                {i < MECHANISM_CARDS.length - 1 && (
                  <div className="hidden md:block" style={{ color: colors.sageGreen, fontSize: "20px", flexShrink: 0 }}>
                    →
                  </div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              background: "#ffffff",
              border: `1px solid ${colors.sageGreen}`,
              borderRadius: radius,
              padding: "18px 20px",
              textAlign: "left",
              marginBottom: "24px",
            }}
            className="hover:shadow-lg transition-shadow duration-200"
          >
            <div style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", color: colors.deepGreen, marginBottom: "4px" }}>AgentMail</div>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: colors.midGreen, marginBottom: "8px" }}>
              In and out, both real
            </div>
            <div style={{ fontSize: "13px", color: colors.inkSoft, lineHeight: 1.45 }}>
              Forward a bill and it's read automatically. When something changes, we email you first — unprompted.
            </div>
          </div>

          <div
            style={{
              background: colors.deepGreen,
              borderRadius: radius,
              padding: "24px 28px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: colors.sageGreen, marginBottom: "10px" }}>
              Core principle
            </div>
            <div style={{ fontFamily: fontSerif, fontSize: "17px", lineHeight: 1.5, color: colors.cream, maxWidth: "620px", margin: "0 auto" }}>
              Every calculation is deterministic. AI only explains, extracts, and narrates — it never invents a number, a rate, or advice.
            </div>
          </div>
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${colors.sageGreen}`, padding: "28px 24px", textAlign: "center" }}>
        <div style={{ marginBottom: "6px" }}>
          <Logo dark wordmarkSize={15} taglineSize={10} />
        </div>
        <div style={{ fontSize: "12px", color: colors.inkSoft }}>Built for the Convex All Gas Hackathon.</div>
      </footer>
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

const navLinkStyle: React.CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "13px",
  color: colors.ink,
  textDecoration: "none",
};

const eyebrowStyle: React.CSSProperties = {
  textAlign: "center",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: colors.midGreen,
  marginBottom: "12px",
};

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
