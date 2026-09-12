import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { colors, fontSans, fontSerif, radius } from "../../theme";
import { ghostButtonStyle, inputStyle, primaryButtonStyle } from "./kit";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "family", label: "Family" },
  { key: "loans", label: "Loans" },
  { key: "career", label: "Career" },
  { key: "shortTermGoal", label: "Short-term goal" },
  { key: "health", label: "Health" },
  { key: "location", label: "Location" },
  { key: "sideIncome", label: "Side income" },
  { key: "misc", label: "Miscellaneous" },
];

export function TimelineOverviewScreen({
  householdId,
  onOpenTimeline,
}: {
  householdId: Id<"households">;
  onOpenTimeline: (timelineId: Id<"timelines">, focusCategory?: string) => void;
}) {
  const timelines = useQuery(api.goalPlanning.listTimelines);
  const createTimeline = useMutation(api.goalPlanning.createTimeline);
  const [search, setSearch] = useState("");

  const handleAdd = async () => {
    const { timelineId } = await createTimeline();
    onOpenTimeline(timelineId);
  };

  const q = search.trim().toLowerCase();
  const filtered = (timelines ?? []).filter(
    (t) =>
      q === "" ||
      t.timeline.label.toLowerCase().includes(q) ||
      t.timeline.yearsLabel.toLowerCase().includes(q),
  );

  return (
    <main style={{ flex: 1, padding: "40px 48px", fontFamily: fontSans, color: colors.ink }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>
        <h1 style={{ fontFamily: fontSerif, fontSize: "28px", margin: "0 0 4px" }}>Your timelines</h1>
        <p style={{ color: colors.inkSoft, fontSize: "14px", margin: "0 0 24px" }}>
          Add a timeline block, then set which years it covers yourself. Nothing is numbered for you.
        </p>

        <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Search or jump to a goal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={primaryButtonStyle}>Search</button>
        </div>

        {timelines === undefined ? (
          <p style={{ color: colors.inkSoft }}>loading…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {filtered.map((t) => (
              <OverviewTimelineCard
                key={t.timeline._id}
                timeline={t.timeline}
                itemCount={t.itemCount}
                suggestionCount={t.suggestionCount}
                confirmed={t.confirmed}
                householdId={householdId}
                onOpen={onOpenTimeline}
              />
            ))}
            <button
              onClick={() => void handleAdd()}
              style={{
                ...ghostButtonStyle,
                padding: "16px",
                borderStyle: "dashed",
                width: "100%",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              + Add a timeline
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function OverviewTimelineCard({
  timeline,
  itemCount,
  suggestionCount,
  confirmed,
  householdId,
  onOpen,
}: {
  timeline: { _id: Id<"timelines">; label: string; yearsLabel: string };
  itemCount: number;
  suggestionCount: number;
  confirmed: boolean;
  householdId: Id<"households">;
  onOpen: (timelineId: Id<"timelines">, focusCategory?: string) => void;
}) {
  const updateYears = useMutation(api.goalPlanning.updateTimelineYears);
  const [expanded, setExpanded] = useState(true);

  const draftKey = `finComp:draft:${householdId}:${timeline._id}:timeline:yearsLabel`;
  const [years, setYears] = useState<string>(() => {
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft !== null) return draft;
    } catch {
      /* ignore */
    }
    return timeline.yearsLabel;
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onYearsChange = (value: string) => {
    setYears(value);
    try {
      localStorage.setItem(draftKey, value);
    } catch {
      /* ignore */
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateYears({ timelineId: timeline._id, yearsLabel: value }).then(() => {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* ignore */
        }
      });
    }, 500);
  };

  return (
    <div style={{ border: `1px solid ${colors.sageGreen}`, borderRadius: radius, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          background: colors.creamDim,
          padding: "12px 16px",
        }}
      >
        <span
          onClick={() => onOpen(timeline._id)}
          style={{ fontFamily: fontSerif, fontWeight: 700, fontSize: "15px", cursor: "pointer" }}
        >
          {timeline.label}
        </span>
        <input
          style={{ ...inputStyle, flex: 1, maxWidth: "220px" }}
          placeholder="e.g. Year 1-3, or Years 4-6"
          value={years}
          onChange={(e) => onYearsChange(e.target.value)}
        />
        {confirmed && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: colors.deepGreen,
              border: `1px solid ${colors.deepGreen}`,
              borderRadius: "10px",
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}
          >
            ✓ Confirmed
          </span>
        )}
        <span style={{ fontSize: "12px", color: colors.inkSoft, whiteSpace: "nowrap" }}>
          {itemCount} {itemCount === 1 ? "item" : "items"}
          {!confirmed && " · not confirmed"}
        </span>
        {suggestionCount > 0 && (
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              background: colors.deepGreen,
              color: colors.cream,
              borderRadius: "10px",
              padding: "2px 8px",
            }}
          >
            {suggestionCount} {suggestionCount === 1 ? "suggestion" : "suggestions"}
          </span>
        )}
        <span
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: "pointer",
            marginLeft: "auto",
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ›
        </span>
      </div>

      {expanded && (
        <div
          style={{
            background: "#ffffff",
            padding: "16px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: "10px",
          }}
        >
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => onOpen(timeline._id, c.key)}
              style={{
                ...ghostButtonStyle,
                borderStyle: "dashed",
                padding: "16px 8px",
                fontWeight: 500,
                color: colors.inkSoft,
              }}
            >
              + {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
