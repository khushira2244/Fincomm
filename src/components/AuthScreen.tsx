import { FormEvent, useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { colors, fontSans, fontSerif, radius } from "../theme";

// Sign-in/sign-up logic is unchanged from the previous build — only the
// layout and styling around it are new.

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

function useIsNarrow(breakpoint = 720): boolean {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = () => setIsNarrow(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);
  return isNarrow;
}

export function AuthScreen() {
  const isNarrow = useIsNarrow();

  return (
    <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", minHeight: "100vh" }}>
      <div
        style={{
          flex: isNarrow ? "none" : "1 1 50%",
          padding: isNarrow ? "48px 24px" : "64px",
          background: colors.deepGreen,
          color: colors.cream,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <h1 style={{ fontFamily: fontSerif, fontSize: isNarrow ? "32px" : "42px", margin: "0 0 16px" }}>
          FinComp
        </h1>
        <p style={{ fontFamily: fontSans, fontSize: "16px", maxWidth: "360px", color: colors.sageGreen, margin: 0 }}>
          One place to see what a decision really means for your household.
        </p>
      </div>

      <div
        style={{
          flex: isNarrow ? "none" : "1 1 50%",
          background: colors.cream,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
        }}
      >
        <SignInForm />
      </div>
    </div>
  );
}

function SignInForm() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
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
        <span
          style={{ fontFamily: fontSans, fontSize: "13px", color: colors.inkSoft, textAlign: "center" }}
        >
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
        {error && (
          <p style={{ fontFamily: fontSans, fontSize: "13px", color: "#a13d3d", margin: 0 }}>{error}</p>
        )}
      </form>
    </div>
  );
}

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
