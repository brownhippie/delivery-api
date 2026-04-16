import { useEffect, useMemo, useState } from "react";
import AddressAutocomplete from "./components/AddressAutocomplete";
import type { AddressSuggestion } from "./api"; // keep type only (component expects it)

type Restaurant = { id: string; name: string };

type Order = {
  id: string;
  restaurant_name?: string;
  restaurantName?: string;
  restaurant_id?: string;
  restaurantId?: string;
  address?: string;
  postal_code?: string | null;
  postalCode?: string | null;
  zone?: string | null;
  fee_cents?: number;
  feeCents?: number;
  status?: "active" | "completed";
  created_at?: number;
  completed_at?: number | null;
};

type RecentAddress = {
  label: string;
  postal: string;
  ts: number;
};

type RateRow = {
  postalPrefix: string;
  zone: string | null;
  feeCents: number;
  updatedAt: number;
};

type RunsResponse = {
  date: string;
  totals: {
    orders: number;
    completed: number;
    active: number;
    totalFeeCents: number;
  };
  orders: Array<{
    id: string;
    createdAt: number;
    completedAt: number | null;
    restaurantName: string;
    address: string;
    postalCode: string;
    zone: string | null;
    feeCents: number;
    status: "active" | "completed";
  }>;
};

const RECENT_KEY = "richie_staff_recent_addresses_v1";
const RECENT_MAX = 8;

const API_URL = (import.meta.env.VITE_API_URL || "http://68.183.197.69:5050").replace(/\/$/, "");

function money(cents: number) {
  const n = Number.isFinite(cents) ? cents : 0;
  return `$${(n / 100).toFixed(2)}`;
}

function normalizePostal(s: string) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function formatPostalCA(p: string) {
  const x = normalizePostal(p).replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (x.length <= 3) return x;
  return `${x.slice(0, 3)} ${x.slice(3)}`;
}

function isLikelyCanadianPostal(raw: string) {
  const x = normalizePostal(raw).replace(/[^A-Z0-9]/g, "");
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(x);
}

// Accept prefix-only like "C1A" (server quote supports 3)
function isLikelyCanadianPrefix3(raw: string) {
  const x = normalizePostal(raw).replace(/[^A-Z0-9]/g, "").slice(0, 3);
  return /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]$/.test(x);
}

function extractCanadianPostalFromText(text: string) {
  const t = String(text || "").toUpperCase();
  const m = t.match(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d\b/);
  return m ? formatPostalCA(m[0]) : "";
}

function readRecent(): RecentAddress[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => ({
        label: String(x?.label || ""),
        postal: formatPostalCA(String(x?.postal || "")),
        ts: Number(x?.ts || 0),
      }))
      .filter((x: RecentAddress) => x.label && x.postal)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(list: RecentAddress[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // ignore
  }
}

function upsertRecent(entry: RecentAddress) {
  const list = readRecent();
  const key = `${entry.label}__${normalizePostal(entry.postal)}`;
  const next = [entry, ...list.filter((x) => `${x.label}__${normalizePostal(x.postal)}` !== key)].slice(0, RECENT_MAX);
  writeRecent(next);
  return next;
}

// ======= Minimal API client matching server.js =======
function getToken() {
  return localStorage.getItem("token") || "";
}
function setToken(t: string) {
  localStorage.setItem("token", t);
}
function clearToken() {
  localStorage.removeItem("token");
}

async function apiReq<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data as T;
}

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function lastNDates(n: number) {
  const out: string[] = [];
  const base = new Date();
  base.setHours(12, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

export default function StaffApp() {
  const [tokenReady, setTokenReady] = useState<boolean>(!!getToken());
  const [err, setErr] = useState<string>("");

  // auth
  const [username, setUsername] = useState("john");
  const [password, setPassword] = useState("1234");

  // restaurants
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState("");

  // status
  const [online, setOnline] = useState(false);

  // create order
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");

  // address mode
  const [addressMode, setAddressMode] = useState<"search" | "manual">("search");

  // recent addresses (local fallback)
  const [recent, setRecent] = useState<RecentAddress[]>(() => readRecent());

  // quote
  const [quoteFeeCents, setQuoteFeeCents] = useState<number | null>(null);
  const [quoteZone, setQuoteZone] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);

  // manual fee override (per order)
  const [useManualFee, setUseManualFee] = useState(false);
  const [manualFeeDollars, setManualFeeDollars] = useState<string>("");

  // active order
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);

  // postal validation warning
  const [postalWarn, setPostalWarn] = useState<string>("");

  // tabs
  const [tab, setTab] = useState<"dashboard" | "rates" | "runs">("dashboard");

  // rates tab
  const [rates, setRates] = useState<RateRow[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratePostalPrefix, setRatePostalPrefix] = useState("C1A");
  const [rateZone, setRateZone] = useState("A");
  const [rateFeeDollars, setRateFeeDollars] = useState("6.00");

  // runs tab
  const [runsDate, setRunsDate] = useState<string>(() => todayISODate());
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);

  const normalizedPostal = useMemo(() => normalizePostal(postalCode).replace(/[^A-Z0-9]/g, ""), [postalCode]);

  function hardLogout() {
    clearToken();
    setTokenReady(false);
    setOnline(false);
    setActiveOrder(null);

    setRestaurants([]);
    setRestaurantId("");

    setAddress("");
    setPostalCode("");
    setQuoteFeeCents(null);
    setQuoteZone(null);
    setPostalWarn("");
    setAddressMode("search");

    setUseManualFee(false);
    setManualFeeDollars("");
    setTab("dashboard");
  }

  function showErr(e: any, fallback: string) {
    // ✅ If token expired / invalid, force relogin (because /restaurants is now auth-protected)
    if (e?.status === 401) {
      setErr("Session expired. Please login again.");
      hardLogout();
      return;
    }
    const status = e?.status ? `HTTP ${e.status}: ` : "";
    const payload = e?.payload ? `\n${JSON.stringify(e.payload, null, 2)}` : "";
    setErr(`${status}${String(e?.message || fallback)}${payload}`);
  }

  useEffect(() => {
    if (!tokenReady) return;
    boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    if (tab === "rates") loadRates();
    if (tab === "runs") loadRuns(runsDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function boot() {
    setErr("");
    try {
      const r = await apiReq<{ restaurants: Restaurant[] }>("/restaurants", { method: "GET" });
      setRestaurants(r.restaurants);
      if (!restaurantId && r.restaurants.length) setRestaurantId(r.restaurants[0].id);
      setRecent(readRecent());
    } catch (e: any) {
      showErr(e, "Failed to load restaurants");
    }
  }

  async function onLogin() {
    setErr("");
    try {
      const res = await apiReq<{ token: string; role: string; username: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (res.role !== "staff") throw new Error("Not a staff account");
      setToken(res.token);
      setTokenReady(true);
    } catch (e: any) {
      showErr(e, "Login failed");
    }
  }

  async function onLogout() {
    setErr("");
    try {
      await apiReq("/auth/logout", { method: "POST" }).catch(() => {});
    } finally {
      hardLogout();
    }
  }

  async function toggleOnline(next: boolean) {
    setErr("");
    try {
      await apiReq("/staff/online", {
        method: "POST",
        body: JSON.stringify({ online: next }),
      });
      setOnline(next);
      if (!next) setActiveOrder(null);
    } catch (e: any) {
      showErr(e, "Failed to set online status");
    }
  }

  function resetQuote() {
    setQuoteFeeCents(null);
    setQuoteZone(null);
  }

  function setAddressAndPostal(label: string, postal: string) {
    setAddress(label);
    setPostalCode(postal ? formatPostalCA(postal) : "");
    setPostalWarn("");
    resetQuote();
  }

  function maybeSaveToRecent(label: string, postal: string) {
    const l = String(label || "").trim();
    const p = formatPostalCA(postal || "");
    if (!l) return setErr("Address required to save");

    const pNorm = normalizePostal(p).replace(/[^A-Z0-9]/g, "");
    if (!pNorm || pNorm.length < 6 || !isLikelyCanadianPostal(p)) {
      setPostalWarn("Enter a full Canadian postal code (e.g. C1A 1A1) to save to Recent.");
      return;
    }

    const next = upsertRecent({ label: l, postal: p, ts: Date.now() });
    setRecent(next);
    setPostalWarn("");
  }

  // ✅ FIX: don’t throw away prefix-only postcodes like "C1A" from autocomplete.
  // If Photon gives only prefix or weird code, keep prefix when valid; warn user to confirm full code.
  function onPickSuggestion(s: AddressSuggestion) {
    const label = String((s as any)?.label || "");
    setAddress(label);

    const rawPc = String((s as any)?.postcode || "");
    const pickedFormatted = rawPc ? formatPostalCA(rawPc) : "";
    const pickedNorm = normalizePostal(pickedFormatted).replace(/[^A-Z0-9]/g, "");
    const fromLabel = extractCanadianPostalFromText(label);
    const fromLabelNorm = normalizePostal(fromLabel).replace(/[^A-Z0-9]/g, "");

    let finalPc = "";

    if (pickedNorm) {
      if (pickedNorm.length >= 6 && isLikelyCanadianPostal(pickedNorm)) {
        finalPc = formatPostalCA(pickedNorm);
        setPostalWarn("");
      } else if (pickedNorm.length === 3 && isLikelyCanadianPrefix3(pickedNorm)) {
        finalPc = pickedNorm; // keep prefix (quote supports 3)
        setPostalWarn("Autocomplete only gave postal prefix. If you need full code, type it manually.");
      } else if (fromLabelNorm && fromLabelNorm.length >= 6 && isLikelyCanadianPostal(fromLabelNorm)) {
        finalPc = formatPostalCA(fromLabelNorm);
        setPostalWarn("");
      } else {
        // keep nothing rather than storing garbage
        finalPc = "";
        setPostalWarn("Autocomplete returned a weird postal code. Type/confirm postal manually.");
      }
    } else {
      if (fromLabelNorm && fromLabelNorm.length >= 6 && isLikelyCanadianPostal(fromLabelNorm)) {
        finalPc = formatPostalCA(fromLabelNorm);
        setPostalWarn("");
      } else {
        finalPc = "";
      }
    }

    if (finalPc) setPostalCode(finalPc);

    // Save to recent ONLY when full Canadian postal (6)
    if (label && finalPc && normalizePostal(finalPc).replace(/[^A-Z0-9]/g, "").length >= 6 && isLikelyCanadianPostal(finalPc)) {
      const next = upsertRecent({ label, postal: finalPc, ts: Date.now() });
      setRecent(next);
    }

    resetQuote();
  }

  async function refreshQuote() {
    setErr("");
    setPostalWarn("");
    setQuoteFeeCents(null);
    setQuoteZone(null);

    const pc = normalizedPostal;
    if (pc.length < 3) return setErr("Postal code required (at least 3 chars, e.g. C1A)");

    setQuoting(true);
    try {
      const q = await apiReq<{ feeCents: number; zone: string | null; postalCode: string }>(
        `/quote?postalCode=${encodeURIComponent(pc)}`,
        { method: "GET" }
      );
      setQuoteFeeCents(q.feeCents);
      setQuoteZone(q.zone);
    } catch (e: any) {
      showErr(e, "Quote failed");
    } finally {
      setQuoting(false);
    }
  }

  function dollarsToCents(v: string) {
    const n = Number(String(v || "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  async function createOrder() {
    setErr("");
    setPostalWarn("");

    const addr = address.trim();
    const pc = normalizedPostal;

    if (!restaurantId) return setErr("Pick a restaurant");
    if (!addr) return setErr("Address required");
    if (pc.length < 3) return setErr("Postal code required (at least 3 chars, e.g. C1A)");

    if (pc.length >= 6 && !isLikelyCanadianPostal(pc)) {
      setPostalWarn("That postal code doesn't look like a Canadian postal. If it's wrong, fee/zone may be wrong.");
    }

    try {
      let fee = quoteFeeCents;
      let zone = quoteZone;

      // manual fee override wins
      if (useManualFee) {
        const manual = dollarsToCents(manualFeeDollars);
        if (manual === null) return setErr("Manual fee is invalid");
        fee = manual;
        zone = zone ?? null;
      } else if (fee === null) {
        const q = await apiReq<{ feeCents: number; zone: string | null; postalCode: string }>(
          `/quote?postalCode=${encodeURIComponent(pc)}`,
          { method: "GET" }
        );
        fee = q.feeCents;
        zone = q.zone;
        setQuoteFeeCents(fee);
        setQuoteZone(zone);
      }

      const payload = {
        restaurantId,
        address: addr,
        postalCode: pc,
        feeCents: fee ?? undefined,
        zone: zone ?? undefined,
        amountCents: 0,
      };

      const res = await apiReq<{ order: Order }>("/orders", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setActiveOrder(res.order);

      // Save to recent ONLY when full 6-char postal
      const prettyPc = formatPostalCA(pc);
      if (addr) {
        const pNorm = normalizePostal(prettyPc).replace(/[^A-Z0-9]/g, "");
        if (pNorm.length >= 6 && isLikelyCanadianPostal(pNorm)) {
          const next = upsertRecent({ label: addr, postal: prettyPc, ts: Date.now() });
          setRecent(next);
        }
      }

      setAddress("");
      setPostalCode("");
      setQuoteFeeCents(null);
      setQuoteZone(null);
      setPostalWarn("");

      setUseManualFee(false);
      setManualFeeDollars("");
    } catch (e: any) {
      showErr(e, "Create order failed");
    }
  }

  async function completeActiveOrder() {
    if (!activeOrder?.id) return;
    setErr("");
    try {
      const r = await apiReq<{ ok: boolean; order: Order }>(`/orders/${encodeURIComponent(activeOrder.id)}/complete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setActiveOrder(r.order ?? null);
    } catch (e: any) {
      showErr(e, "Complete failed");
    }
  }

  async function loadRates() {
    setErr("");
    setRatesLoading(true);
    try {
      const r = await apiReq<{ rates: RateRow[] }>("/rates", { method: "GET" });
      setRates(r.rates || []);
    } catch (e: any) {
      showErr(e, "Failed to load rates");
    } finally {
      setRatesLoading(false);
    }
  }

  async function upsertRate() {
    setErr("");
    const prefix = normalizePostal(ratePostalPrefix).replace(/[^A-Z0-9]/g, "").slice(0, 3);
    if (prefix.length !== 3) return setErr("Postal prefix must be 3 chars (e.g. C1A)");
    const feeCents = dollarsToCents(rateFeeDollars);
    if (feeCents === null) return setErr("Fee is invalid");
    const zone = String(rateZone || "").trim() || null;

    try {
      await apiReq<{ ok: boolean; rate: RateRow }>("/rates", {
        method: "POST",
        body: JSON.stringify({ postalPrefix: prefix, zone, feeCents }),
      });
      await loadRates();
    } catch (e: any) {
      showErr(e, "Failed to save rate");
    }
  }

  async function loadRuns(dateISO: string) {
    setErr("");
    setRunsLoading(true);
    try {
      const r = await apiReq<RunsResponse>(`/staff/runs?date=${encodeURIComponent(dateISO)}`, { method: "GET" });
      setRuns(r);
    } catch (e: any) {
      showErr(e, "Failed to load runs");
    } finally {
      setRunsLoading(false);
    }
  }

  if (!tokenReady) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h1 style={styles.h1}>Staff</h1>
          <div style={styles.muted}>Login</div>

          <div style={styles.row}>
            <input style={styles.input} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          </div>

          <div style={styles.row}>
            <input
              style={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
            />
          </div>

          <button style={styles.btnPrimary} onClick={onLogin} type="button">
            Login
          </button>

          {err ? <pre style={styles.err}>{err}</pre> : null}

          <div style={styles.mutedSmall}>Seed users: john/1234, sarah/5678 (staff), richie/9999</div>
        </div>
      </div>
    );
  }

  const activePc = activeOrder?.postalCode ?? activeOrder?.postal_code ?? null;
  const activeFee = Number(activeOrder?.feeCents ?? activeOrder?.fee_cents ?? 0);

  const runDates = useMemo(() => lastNDates(7), []);
  const manualFeeCentsPreview = useMemo(
    () => (useManualFee ? dollarsToCents(manualFeeDollars) : null),
    [useManualFee, manualFeeDollars]
  );

  return (
    <div style={styles.pageWide}>
      <div style={styles.topRow}>
        <div style={styles.title}>Staff Dashboard</div>
        <button style={styles.btnGhost} onClick={onLogout} type="button">
          Logout
        </button>
      </div>

      {err ? <pre style={styles.errWide}>{err}</pre> : null}
      {postalWarn ? <div style={styles.warnWide}>{postalWarn}</div> : null}

      <div style={styles.tabs}>
        <button type="button" style={styles.tabBtn(tab === "dashboard")} onClick={() => setTab("dashboard")}>
          Dashboard
        </button>
        <button type="button" style={styles.tabBtn(tab === "rates")} onClick={() => setTab("rates")}>
          Rates
        </button>
        <button type="button" style={styles.tabBtn(tab === "runs")} onClick={() => setTab("runs")}>
          Runs (7 days)
        </button>
      </div>

      {tab === "dashboard" ? (
        <>
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Status</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button style={styles.btnSmall(online)} onClick={() => toggleOnline(true)} type="button">
                Online
              </button>
              <button style={styles.btnSmall(!online)} onClick={() => toggleOnline(false)} type="button">
                Offline
              </button>
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelTitle}>Create Order</div>

            <div style={styles.row}>
              <label style={styles.label}>Restaurant</label>
              <select style={styles.select} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)}>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.row}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <label style={styles.label}>Address</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={styles.chip(addressMode === "search")} onClick={() => setAddressMode("search")}>
                    Search
                  </button>
                  <button type="button" style={styles.chip(addressMode === "manual")} onClick={() => setAddressMode("manual")}>
                    Manual
                  </button>
                </div>
              </div>

              {addressMode === "search" ? (
                <AddressAutocomplete
                  value={address}
                  onChange={(v) => {
                    setAddress(v);
                    resetQuote();
                    setPostalWarn("");
                  }}
                  onPick={onPickSuggestion}
                  placeholder="Start typing (e.g. 100 Queen)"
                />
              ) : (
                <input
                  style={styles.input}
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    resetQuote();
                    setPostalWarn("");
                  }}
                  placeholder="Type full address (e.g. 100 Queen St, Charlottetown)"
                />
              )}

              {recent.length ? (
                <div style={styles.recentWrap}>
                  <div style={styles.recentTitle}>Recent (local)</div>
                  <div style={styles.recentGrid}>
                    {recent.slice(0, 5).map((x) => (
                      <button
                        key={`${x.label}__${x.postal}`}
                        type="button"
                        onClick={() => setAddressAndPostal(x.label, x.postal)}
                        style={styles.recentBtn}
                        title={x.label}
                      >
                        <div style={styles.recentAddr}>{x.label}</div>
                        <div style={styles.recentPostal}>{x.postal}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div style={styles.row}>
              <label style={styles.label}>Postal Code</label>
              <input
                style={styles.input}
                value={postalCode}
                onChange={(e) => {
                  const v = formatPostalCA(e.target.value);
                  setPostalCode(v);
                  resetQuote();
                  setPostalWarn("");

                  const n = normalizePostal(v).replace(/[^A-Z0-9]/g, "");
                  if (n.length >= 6 && !isLikelyCanadianPostal(n)) {
                    setPostalWarn("That postal code doesn't look Canadian. Double-check it.");
                  }
                }}
                placeholder="C1A 1A1 (or at least C1A)"
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" style={styles.btnGhost} onClick={() => maybeSaveToRecent(address, postalCode)}>
                  Save to Recent
                </button>
                <div style={{ opacity: 0.7, fontSize: 12, alignSelf: "center" }}>Tip: Save once → it becomes one-tap next time.</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button style={styles.btnGhost} onClick={refreshQuote} type="button" disabled={quoting}>
                {quoting ? "Quoting..." : "Get Fee / Zone"}
              </button>

              {quoteFeeCents !== null ? (
                <div style={{ fontWeight: 900 }}>
                  Fee: {money(quoteFeeCents)} {quoteZone ? <span style={{ opacity: 0.75 }}>({quoteZone})</span> : null}
                </div>
              ) : (
                <div style={{ opacity: 0.7, fontSize: 12 }}>Fee auto-calculates on Create if you skip this.</div>
              )}
            </div>

            <div style={styles.panelInner}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.85 }}>Manual Fee Override (optional)</div>
                <button type="button" style={styles.chip(useManualFee)} onClick={() => setUseManualFee((v) => !v)}>
                  {useManualFee ? "ON" : "OFF"}
                </button>
              </div>

              {useManualFee ? (
                <div style={{ marginTop: 10 }}>
                  <label style={styles.label}>Manual Fee ($)</label>
                  <input
                    style={styles.input}
                    value={manualFeeDollars}
                    onChange={(e) => setManualFeeDollars(e.target.value)}
                    placeholder="e.g. 6.00"
                  />
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    Will create the order with fee:{" "}
                    <span style={{ fontWeight: 900 }}>{manualFeeCentsPreview === null ? "-" : money(manualFeeCentsPreview)}</span>
                  </div>
                </div>
              ) : null}
            </div>

            <button style={styles.btnPrimary} onClick={createOrder} type="button">
              Create Order
            </button>
          </div>

          {activeOrder ? (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Active Order</div>

              <div style={styles.kv}>
                <div style={styles.k}>ID</div>
                <div style={styles.v}>{activeOrder.id}</div>
              </div>

              <div style={styles.kv}>
                <div style={styles.k}>Address</div>
                <div style={styles.v}>{activeOrder.address || "-"}</div>
              </div>

              <div style={styles.kv}>
                <div style={styles.k}>Postal</div>
                <div style={styles.v}>{activePc ? formatPostalCA(String(activePc)) : "-"}</div>
              </div>

              <div style={styles.kv}>
                <div style={styles.k}>Fee</div>
                <div style={styles.v}>{money(activeFee)}</div>
              </div>

              <button style={styles.btnPrimary} onClick={completeActiveOrder} type="button">
                Mark Completed
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {tab === "rates" ? (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Rates (stored in DB)</div>

          <div style={styles.row}>
            <label style={styles.label}>Postal Prefix (3 chars)</label>
            <input
              style={styles.input}
              value={ratePostalPrefix}
              onChange={(e) => setRatePostalPrefix(e.target.value)}
              placeholder="C1A"
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>Zone (optional)</label>
            <input style={styles.input} value={rateZone} onChange={(e) => setRateZone(e.target.value)} placeholder="A" />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>Fee ($)</label>
            <input style={styles.input} value={rateFeeDollars} onChange={(e) => setRateFeeDollars(e.target.value)} placeholder="6.00" />
          </div>

          <button style={styles.btnPrimary} onClick={upsertRate} type="button">
            Save Rate
          </button>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.8 }}>Existing Rates</div>
            <button style={styles.btnGhost} type="button" onClick={loadRates} disabled={ratesLoading}>
              {ratesLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {(rates || []).map((r) => (
              <div key={r.postalPrefix} style={styles.rateRow}>
                <div style={{ fontWeight: 900 }}>{r.postalPrefix}</div>
                <div style={{ opacity: 0.85 }}>{r.zone || "-"}</div>
                <div style={{ fontWeight: 900 }}>{money(r.feeCents)}</div>
                <div style={{ opacity: 0.65, fontSize: 12 }}>{new Date(r.updatedAt).toLocaleString()}</div>
              </div>
            ))}
            {!ratesLoading && (!rates || rates.length === 0) ? (
              <div style={{ opacity: 0.7, fontSize: 12 }}>No rates yet. Add one (ex: C1A → $6.00).</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Runs (Last 7 days)</div>

          <div style={styles.row}>
            <label style={styles.label}>Pick date</label>
            <select
              style={styles.select}
              value={runsDate}
              onChange={(e) => {
                const d = e.target.value;
                setRunsDate(d);
                loadRuns(d);
              }}
            >
              {runDates.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginTop: 10 }}>
            <button style={styles.btnGhost} type="button" onClick={() => loadRuns(runsDate)} disabled={runsLoading}>
              {runsLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {runs ? (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={styles.runSummary}>
                <div style={styles.runBox}>
                  <div style={styles.runLabel}>Orders</div>
                  <div style={styles.runValue}>{runs.totals.orders}</div>
                </div>
                <div style={styles.runBox}>
                  <div style={styles.runLabel}>Completed</div>
                  <div style={styles.runValue}>{runs.totals.completed}</div>
                </div>
                <div style={styles.runBox}>
                  <div style={styles.runLabel}>Active</div>
                  <div style={styles.runValue}>{runs.totals.active}</div>
                </div>
                <div style={styles.runBox}>
                  <div style={styles.runLabel}>Total Fees</div>
                  <div style={styles.runValue}>{money(runs.totals.totalFeeCents)}</div>
                </div>
              </div>

              <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.8 }}>Orders</div>
              <div style={{ display: "grid", gap: 8 }}>
                {runs.orders.map((o) => (
                  <div key={o.id} style={styles.orderRow}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 900 }}>{o.restaurantName}</div>
                      <div style={{ fontWeight: 900 }}>{money(o.feeCents)}</div>
                    </div>
                    <div style={{ opacity: 0.85, fontSize: 12, marginTop: 4 }}>{o.address}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {formatPostalCA(o.postalCode)} {o.zone ? `(${o.zone})` : ""}
                      </div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>
                        {o.status.toUpperCase()} •{" "}
                        {new Date(o.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                ))}
                {runs.orders.length === 0 ? <div style={{ opacity: 0.7, fontSize: 12 }}>No orders for this date.</div> : null}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10, opacity: 0.7, fontSize: 12 }}>Pick a date to load runs.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: "100vh",
    background: "#0b0d12",
    color: "white",
    padding: 16,
    display: "grid",
    placeItems: "center",
    fontFamily: "system-ui, Arial",
  },
  pageWide: {
    minHeight: "100vh",
    background: "#0b0d12",
    color: "white",
    padding: 16,
    display: "grid",
    gap: 12,
    width: "100%",
    maxWidth: 680,
    margin: "0 auto",
    fontFamily: "system-ui, Arial",
  },
  topRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  title: { fontSize: 22, fontWeight: 900 },
  card: { width: 420, maxWidth: "96vw", background: "#151821", border: "1px solid #222736", borderRadius: 16, padding: 18 },
  panel: { background: "#151821", border: "1px solid #222736", borderRadius: 16, padding: 16 },
  panelInner: { marginTop: 12, background: "#0f1115", border: "1px solid #2b3142", borderRadius: 14, padding: 12 },
  panelTitle: { fontWeight: 900, marginBottom: 10, fontSize: 14, letterSpacing: 0.2 },
  h1: { margin: 0, fontSize: 28 },
  muted: { opacity: 0.75, marginTop: 8 },
  mutedSmall: { opacity: 0.7, fontSize: 12, marginTop: 8 },
  row: { marginTop: 12 },
  label: { display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 },
  input: { width: "100%", padding: "12px 12px", borderRadius: 12, border: "1px solid #2b3142", background: "#0f1115", color: "white" },
  select: { width: "100%", padding: "12px 12px", borderRadius: 12, border: "1px solid #2b3142", background: "#0f1115", color: "white" },
  btnPrimary: { marginTop: 14, width: "100%", padding: 12, borderRadius: 12, border: "none", background: "#a855f7", color: "white", fontWeight: 900, cursor: "pointer" },
  btnGhost: { padding: "10px 12px", borderRadius: 12, border: "1px solid #2b3142", background: "transparent", color: "white", cursor: "pointer" },
  btnSmall: (active: boolean) => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${active ? "#a855f7" : "#2b3142"}`,
    background: active ? "#2a143a" : "transparent",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    minWidth: 110,
  }),
  chip: (active: boolean) => ({
    padding: "8px 10px",
    borderRadius: 999,
    border: `1px solid ${active ? "#a855f7" : "#2b3142"}`,
    background: active ? "#2a143a" : "transparent",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  }),
  kv: { display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, padding: "6px 0" },
  k: { opacity: 0.7, fontSize: 12 },
  v: { fontWeight: 800, overflowWrap: "anywhere" },
  err: { marginTop: 12, color: "#f87171", fontWeight: 800, whiteSpace: "pre-wrap" },
  errWide: {
    marginBottom: 10,
    color: "#f87171",
    fontWeight: 900,
    background: "#2a0f12",
    border: "1px solid #4a1a21",
    padding: 10,
    borderRadius: 12,
    whiteSpace: "pre-wrap",
  },
  warnWide: { marginBottom: 10, color: "#fbbf24", fontWeight: 900, background: "#2a210f", border: "1px solid #4a3a1a", padding: 10, borderRadius: 12 },

  recentWrap: { marginTop: 10 },
  recentTitle: { fontSize: 12, opacity: 0.75, marginBottom: 6 },
  recentGrid: { display: "grid", gridTemplateColumns: "1fr", gap: 8 },
  recentBtn: {
    textAlign: "left",
    padding: 10,
    borderRadius: 12,
    border: "1px solid #2b3142",
    background: "#0f1115",
    color: "white",
    cursor: "pointer",
  },
  recentAddr: { fontWeight: 850, fontSize: 12, lineHeight: 1.25, marginBottom: 4 },
  recentPostal: { fontSize: 12, opacity: 0.7, fontWeight: 800 },

  tabs: { display: "flex", gap: 8, flexWrap: "wrap" },
  tabBtn: (active: boolean) => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${active ? "#a855f7" : "#2b3142"}`,
    background: active ? "#2a143a" : "transparent",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 12,
  }),

  rateRow: {
    display: "grid",
    gridTemplateColumns: "70px 60px 90px 1fr",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid #2b3142",
    background: "#0f1115",
    alignItems: "center",
  },

  runSummary: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 },
  runBox: { padding: 12, borderRadius: 12, border: "1px solid #2b3142", background: "#0f1115" },
  runLabel: { fontSize: 12, opacity: 0.75, fontWeight: 900 },
  runValue: { marginTop: 4, fontSize: 18, fontWeight: 900 },

  orderRow: { padding: 12, borderRadius: 12, border: "1px solid #2b3142", background: "#0f1115" },
};
