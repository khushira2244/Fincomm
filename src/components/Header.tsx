import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { Logo } from "./Logo";
import { colors, fontSans, radius } from "../theme";

// Persistent, full-width top header — sits above BOTH the sidebar and
// the main content, rendered once by App.tsx's root layout so it's the
// same on every authenticated screen. Owns all account-identity chrome
// (logo/tagline, avatar + a click-open dropdown with email/household/
// sign out); the Sidebar below it is navigation only and repeats none
// of this.
export function Header() {
  const me = useQuery(api.users.getCurrentUser);
  const mine = useQuery(api.households.getMine);
  const { signOut } = useAuthActions();
  const initial = me?.name ? me.name.trim()[0] : undefined;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        minHeight: "64px",
        padding: "10px 24px",
        background: colors.cream,
        borderBottom: `1px solid ${colors.sageGreen}`,
        fontFamily: fontSans,
      }}
    >
      <Logo dark wordmarkSize={18} taglineSize={11} />

      <div ref={menuRef} style={{ position: "relative" }}>
        <div onClick={() => setMenuOpen((v) => !v)} style={{ cursor: "pointer" }}>
          <Avatar initial={initial} />
        </div>
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              minWidth: "200px",
              background: "#ffffff",
              border: `1px solid ${colors.sageGreen}`,
              borderRadius: radius,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              padding: "12px 14px",
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, color: colors.ink, whiteSpace: "nowrap" }}>{me?.name ?? "…"}</div>
            <div style={{ fontSize: "12px", color: colors.inkSoft, whiteSpace: "nowrap", marginBottom: "10px" }}>{mine?.household.name ?? "…"}</div>
            <div
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              style={{
                fontSize: "13px",
                color: colors.deepGreen,
                fontWeight: 600,
                cursor: "pointer",
                userSelect: "none",
                paddingTop: "10px",
                borderTop: `1px solid ${colors.creamDim}`,
              }}
            >
              Sign out
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
