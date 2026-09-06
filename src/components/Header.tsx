import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { colors, fontSerif } from "../theme";

// Persistent top header: wordmark + avatar. Used standalone on screens
// that don't have the sidebar shell (currently just the brief moment
// between signing in and a household existing).
export function Header() {
  const me = useQuery(api.users.getCurrentUser);
  const initial = me?.name ? me.name.trim()[0] : undefined;

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "16px 24px",
        background: colors.cream,
        borderBottom: `1px solid ${colors.sageGreen}`,
      }}
    >
      <span style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "22px", color: colors.deepGreen }}>
        FinComp
      </span>
      <Avatar initial={initial} />
    </header>
  );
}
