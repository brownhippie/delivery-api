import { useEffect, useMemo, useRef, useState } from "react";
import type { AddressSuggestion } from "../api";
import { api } from "../api";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onPick: (s: AddressSuggestion) => void;
  placeholder?: string;
};

export default function AddressAutocomplete({ value, onChange, onPick, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const tRef = useRef<number | null>(null);

  const q = useMemo(() => (value || "").trim(), [value]);

  useEffect(() => {
    if (tRef.current) window.clearTimeout(tRef.current);

    if (q.length < 3) {
      setList([]);
      setOpen(false);
      setErr("");
      setLoading(false);
      return;
    }

    tRef.current = window.setTimeout(async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await api.addressAutocomplete(q);
        const arr = Array.isArray(r.suggestions) ? r.suggestions : [];
        setList(arr);
        setOpen(true);
      } catch (e: any) {
        setErr(e?.message || "Autocomplete failed");
        setList([]);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (tRef.current) window.clearTimeout(tRef.current);
    };
  }, [q]);

  function pick(s: AddressSuggestion) {
    onPick(s);
    setOpen(false);
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Start typing address..."}
        style={styles.input}
        onFocus={() => {
          if (list.length) setOpen(true);
        }}
      />

      {open ? (
        <div style={styles.dropdown}>
          {loading ? <div style={styles.itemMuted}>Loading…</div> : null}
          {err ? <div style={styles.itemErr}>{err}</div> : null}
          {!loading && !err && list.length === 0 ? (
            <div style={styles.itemMuted}>No suggestions</div>
          ) : null}

          {list.map((s) => (
            <button key={s.id} style={styles.itemBtn} onClick={() => pick(s)} type="button">
              <div style={{ fontWeight: 800 }}>{s.label}</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {s.city || ""} {s.postcode ? `• ${formatPostalCA(s.postcode)}` : ""}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatPostalCA(pc: string) {
  const p = String(pc || "").trim().toUpperCase().replace(/\s+/g, "");
  if (p.length === 6) return `${p.slice(0, 3)} ${p.slice(3)}`;
  return p;
}

const styles: Record<string, any> = {
  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #2b3142",
    background: "#0f1115",
    color: "white",
  },
  dropdown: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "calc(100% + 8px)",
    background: "#151821",
    border: "1px solid #222736",
    borderRadius: 14,
    overflow: "hidden",
    zIndex: 50,
  },
  itemBtn: {
    width: "100%",
    textAlign: "left",
    padding: 12,
    border: "none",
    background: "transparent",
    color: "white",
    cursor: "pointer",
    borderBottom: "1px solid #222736",
  },
  itemMuted: {
    padding: 12,
    fontSize: 13,
    opacity: 0.75,
  },
  itemErr: {
    padding: 12,
    fontSize: 13,
    color: "#f87171",
    fontWeight: 800,
  },
};
