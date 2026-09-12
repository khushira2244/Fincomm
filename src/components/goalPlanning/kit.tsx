import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { colors, fontSans, fontSerif, radius } from "../../theme";

// Shared UI bits for Goal & Situation Planning. Deliberately a parallel
// copy of Financial Foundation's local styles rather than a refactor of
// them — FF's files stay untouched.

export const inputStyle: CSSProperties = {
  fontFamily: fontSans,
  fontSize: "14px",
  background: "#ffffff",
  color: colors.ink,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "8px 10px",
};

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "60px",
  resize: "vertical",
  width: "100%",
  boxSizing: "border-box",
};

export const primaryButtonStyle: CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "14px",
  background: colors.deepGreen,
  color: colors.cream,
  border: "none",
  borderRadius: radius,
  padding: "8px 16px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const ghostButtonStyle: CSSProperties = {
  fontFamily: fontSans,
  fontWeight: 600,
  fontSize: "13px",
  background: "#ffffff",
  color: colors.deepGreen,
  border: `1px solid ${colors.sageGreen}`,
  borderRadius: radius,
  padding: "6px 12px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const linkStyle: CSSProperties = {
  fontSize: "13px",
  color: colors.deepGreen,
  textDecoration: "underline",
  cursor: "pointer",
  display: "inline-block",
  marginTop: "10px",
};

export const formRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  alignItems: "flex-start",
  marginTop: "12px",
};

export function Card({ children }: { children: ReactNode }) {
  return (
    <section
      style={{
        background: "#ffffff",
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        padding: "20px 24px",
      }}
    >
      {children}
    </section>
  );
}

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      style={{
        border: `1px solid ${colors.sageGreen}`,
        borderRadius: radius,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: colors.creamDim,
          border: "none",
          padding: "12px 20px",
          cursor: "pointer",
          fontFamily: fontSerif,
          fontSize: "15px",
          fontWeight: 700,
          color: colors.ink,
        }}
      >
        {title}
        <span
          style={{
            display: "inline-block",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ›
        </span>
      </button>
      {open && <div style={{ padding: "16px 20px", background: "#ffffff" }}>{children}</div>}
    </section>
  );
}

export function SubLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: colors.midGreen,
        marginTop: "18px",
        marginBottom: "2px",
      }}
    >
      {children}
    </div>
  );
}

export function NoEntries() {
  return <div style={{ fontSize: "13px", color: colors.inkSoft, marginTop: "4px" }}>No entries yet</div>;
}

export function EntryRow({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
        padding: "8px 0",
        borderBottom: `1px solid ${colors.creamDim}`,
        fontSize: "14px",
      }}
    >
      <span>{label}</span>
      {detail !== undefined && <span style={{ color: colors.inkSoft }}>{detail}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------
// Draft auto-save: every in-progress input value is written to
// localStorage (debounced ~500ms), restored on load, and cleared when
// the entry is actually saved. Keyed household+timeline+category+field.
// ---------------------------------------------------------------------

const DRAFT_PREFIX = "finComp:draft:";

function readDraft(key: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function useDraft(key: string): {
  value: string;
  setValue: (next: string) => void;
  clear: () => void;
} {
  const [value, setValueState] = useState<string>(() => readDraft(key));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValueState(readDraft(key));
  }, [key]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        try {
          if (next === "") localStorage.removeItem(DRAFT_PREFIX + key);
          else localStorage.setItem(DRAFT_PREFIX + key, next);
        } catch {
          /* storage unavailable — ignore */
        }
      }, 500);
    },
    [key],
  );

  const clear = useCallback(() => {
    setValueState("");
    if (timer.current) clearTimeout(timer.current);
    try {
      localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      /* ignore */
    }
  }, [key]);

  return { value, setValue, clear };
}
