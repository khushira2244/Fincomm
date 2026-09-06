import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Avatar } from "./Avatar";
import { colors, fontSans, fontSerif, SIDEBAR_WIDTH } from "../theme";

type ServiceGroup = {
  title: string;
  services: string[];
};

// Only "Financial Foundation" (group 0, service 0) is real. Everything
// else is a placeholder for services that don't exist yet.
const GROUPS: ServiceGroup[] = [
  { title: "Foundation", services: ["Financial Foundation", "Goal & Situation Planning"] },
  {
    title: "Income & Work",
    services: [
      "Income Resilience",
      "Side-Income & Business Planning",
      "Economic & Role-Change Intelligence",
    ],
  },
  {
    title: "Debt & Protection",
    services: ["Loan & Debt Guidance", "Tax Planning", "Insurance & Protection"],
  },
  {
    title: "Growth & Rights",
    services: ["Investment & Risk Planning", "Rights & Government Opportunities"],
  },
];

const ACTIVE_SERVICE = "Financial Foundation";

export function Sidebar() {
  const me = useQuery(api.users.getCurrentUser);
  const mine = useQuery(api.households.getMine);
  const [openGroups, setOpenGroups] = useState<Set<number>>(() => new Set([0]));

  const toggleGroup = (index: number) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <nav
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        minHeight: "100vh",
        background: colors.deepGreen,
        color: colors.cream,
        display: "flex",
        flexDirection: "column",
        padding: "20px 0",
        fontFamily: fontSans,
      }}
    >
      <div style={{ padding: "0 20px 20px", fontFamily: fontSerif, fontWeight: 700, fontSize: "20px" }}>
        FinComp
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "12px 20px",
          borderTop: `1px solid ${colors.midGreen}`,
          borderBottom: `1px solid ${colors.midGreen}`,
          marginBottom: "12px",
        }}
      >
        <Avatar initial={me?.name ? me.name.trim()[0] : undefined} />
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {me?.name ?? "…"}
          </div>
          <div style={{ fontSize: "12px", color: colors.sageGreen, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {mine?.household.name ?? "…"}
          </div>
        </div>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        {GROUPS.map((group, i) => (
          <SidebarGroup
            key={group.title}
            group={group}
            open={openGroups.has(i)}
            onToggle={() => toggleGroup(i)}
          />
        ))}
      </div>
    </nav>
  );
}

function SidebarGroup({
  group,
  open,
  onToggle,
}: {
  group: ServiceGroup;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: colors.sageGreen,
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "10px 20px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {group.title}
        <Chevron open={open} />
      </button>
      {open && (
        <ul style={{ listStyle: "none", margin: 0, padding: "0 0 8px" }}>
          {group.services.map((service) => (
            <ServiceItem key={service} name={service} active={service === ACTIVE_SERVICE} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ServiceItem({ name, active }: { name: string; active: boolean }) {
  if (active) {
    return (
      <li>
        <div
          style={{
            padding: "8px 20px",
            background: colors.midGreen,
            color: colors.cream,
            fontSize: "14px",
            fontWeight: 600,
            cursor: "default",
          }}
        >
          {name}
        </div>
      </li>
    );
  }

  return (
    <li>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 20px",
          color: colors.sageGreen,
          opacity: 0.55,
          fontSize: "14px",
          cursor: "not-allowed",
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        <span>{name}</span>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            border: `1px solid ${colors.sageGreen}`,
            borderRadius: "4px",
            padding: "1px 5px",
          }}
        >
          Soon
        </span>
      </div>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
