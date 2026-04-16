import { useEffect, useMemo, useState } from "react";
import { api, getToken, setToken, clearToken } from "./api";

type StaffApiRow = {
  username: string;
  online: number;
  busy: number;

  last_lat?: number | null;
  last_lng?: number | null;
  last_accuracy?: number | null;
  note_last_ping_at?: number | null;

  last_ping_at?: number | null;

  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  pingAt?: number | null;
};

type StaffOnline = {
  username: string;
  secondsAgo: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
  busy: boolean;
};

type OrderApiRow = any;

type Order = {
  id: string;
  createdAt: number;
  staffUsername: string;
  restaurantName: string;
  address: string;
  amountCents: number;
  feeCents: number;
  postalCode?: string | null;
  zone?: string | null;
  status: "active" | "completed";
  completedAt?: number | null;
};

type UserRow = {
  id: number;
  username: string;
  role: "staff" | "richie";
  disabled: number;
  createdAt?: number | null;
  createdBy?: string | null;
};

type RestaurantRow = {
  id: string;
  name: string;
  active?: number;
  createdAt?: number | null;
  createdBy?: string | null;
};

function money(cents: number) {
  const n = Number.isFinite(cents) ? cents : 0;
  return `$${(n / 100).toFixed(2)}`;
}

function pickNumber(...vals: Array<any>) {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function mapStaff(rows: StaffApiRow[]): StaffOnline[] {
  const now = Date.now();
  return (rows || []).map((s) => {
    const pingAt = pickNumber(s.pingAt, s.last_ping_at);
    const secondsAgo = typeof pingAt === "number" ? Math.max(0, Math.floor((now - pingAt) / 1000)) : 9999;

    const lat = pickNumber(s.lat, s.last_lat);
    const lng = pickNumber(s.lng, s.last_lng);
    const accuracy = pickNumber(s.accuracy, s.last_accuracy);

    return {
      username: s.username,
      secondsAgo,
      lat,
      lng,
      accuracy,
      busy: !!s.busy,
    };
  });
}

function mapOrders(rows: OrderApiRow[]): Order[] {
  const list = Array.isArray(rows) ? rows : [];
  return list
    .map((o) => {
      const id = String(o?.id || "");
      if (!id) return null;

      const restaurantName = String(o?.restaurantName ?? o?.restaurant_name ?? "");
      const staffUsername = String(o?.staffUsername ?? o?.staff_username ?? "");
      const address = String(o?.address ?? "");
      const status = String(o?.status ?? "active") as "active" | "completed";

      const createdAt = Number(o?.createdAt ?? o?.created_at ?? 0);
      const completedAtRaw = o?.completedAt ?? o?.completed_at ?? null;
      const completedAt = completedAtRaw == null ? null : Number(completedAtRaw);

      const feeCents = Number(o?.feeCents ?? o?.fee_cents ?? 0) || 0;
      const amountCents = Number(o?.amountCents ?? o?.amount_cents ?? 0) || 0;

      const postalCode = o?.postalCode ?? o?.postal_code ?? null;
      const zone = o?.zone ?? null;

      return {
        id,
        createdAt,
        completedAt,
        staffUsername,
        restaurantName,
        address,
        amountCents,
        feeCents,
        postalCode: postalCode == null ? null : String(postalCode),
        zone: zone == null ? null : String(zone),
        status: status === "completed" ? "completed" : "active",
      };
    })
    .filter(Boolean) as Order[];
}

function fmtAgo(secondsAgo: number) {
  if (!Number.isFinite(secondsAgo)) return "—";
  if (secondsAgo < 60) return `${secondsAgo}s`;
  const m = Math.floor(secondsAgo / 60);
  const s = secondsAgo % 60;
  return `${m}m ${s}s`;
}

function describeErr(e: any) {
  const status = Number(e?.status || 0);
  const msg = String(e?.message || "Unknown error");
  const payload = e?.payload;

  if (status === 0) return msg; // already includes URL + hint
  if (payload == null) return `HTTP ${status}: ${msg}`;

  let payloadText = "";
  try {
    payloadText = typeof payload === "string" ? payload : JSON.stringify(payload);
  } catch {
    payloadText = String(payload);
  }
  return `HTTP ${status}: ${msg}${payloadText ? ` • ${payloadText}` : ""}`;
}

export default function RichieApp() {
  const [tokenReady, setTokenReady] = useState<boolean>(!!getToken());
  const [err, setErr] = useState("");

  // auth
  const [username, setUsername] = useState("richie");
  const [password, setPassword] = useState("9999");

  // tabs
  const [tab, setTab] = useState<"drivers" | "orders" | "users" | "restaurants">("drivers");

  // data
  const [staff, setStaff] = useState<StaffOnline[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  // admin users
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  // restaurants
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [restaurantsLoading, setRestaurantsLoading] = useState(false);
  const [restName, setRestName] = useState("");
  const [restCreating, setRestCreating] = useState(false);

  // create driver form
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [creating, setCreating] = useState(false);

  const onlineCount = useMemo(() => staff.length, [staff.length]);
  const available = useMemo(() => staff.filter((s) => !s.busy), [staff]);
  const busy = useMemo(() => staff.filter((s) => s.busy), [staff]);

  function hardLogout(message?: string) {
    clearToken();
    setTokenReady(false);
    setStaff([]);
    setOrders([]);
    setUsers([]);
    setRestaurants([]);
    if (message) setErr(message);
  }

  function handleApiError(e: any, fallback: string) {
    const status = Number(e?.status || 0);
    if (status === 401) return hardLogout("Session expired / invalid token. Please login again.");
    setErr(e ? describeErr(e) : fallback);
  }

  async function refresh() {
    setErr("");
    try {
      const [sRes, oRes] = await Promise.all([api.getOnlineStaff(), api.getActiveOrders()]);
      setStaff(mapStaff((sRes.staff || []) as StaffApiRow[]));
      setOrders(mapOrders(oRes.orders || []));
    } catch (e: any) {
      handleApiError(e, "Refresh failed");
    }
  }

  async function loadUsers() {
    setErr("");
    setUsersLoading(true);
    try {
      const r = await api.listUsers("staff");
      setUsers((r.users || []) as UserRow[]);
    } catch (e: any) {
      handleApiError(e, "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }

  async function loadRestaurants() {
    setErr("");
    setRestaurantsLoading(true);
    try {
      const r = await api.listRestaurants();
      setRestaurants((r.restaurants || []) as RestaurantRow[]);
    } catch (e: any) {
      handleApiError(e, "Failed to load restaurants");
    } finally {
      setRestaurantsLoading(false);
    }
  }

  async function createRestaurant() {
    setErr("");
    const name = restName.trim();
    if (!name) return setErr("Restaurant name required");

    setRestCreating(true);
    try {
      await api.createRestaurant(name);
      setRestName("");
      await loadRestaurants();
    } catch (e: any) {
      handleApiError(e, "Create restaurant failed");
    } finally {
      setRestCreating(false);
    }
  }

  async function boot() {
    setErr("");
    try {
      await refresh();
      await loadUsers().catch(() => {});
      await loadRestaurants().catch(() => {});
    } catch (e: any) {
      handleApiError(e, "Failed to load");
    }
  }

  useEffect(() => {
    if (!tokenReady) return;
    boot();

    const t = window.setInterval(() => {
      refresh();
    }, 4000);

    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenReady]);

  useEffect(() => {
    if (!tokenReady) return;
    if (tab === "users") loadUsers();
    if (tab === "restaurants") loadRestaurants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tokenReady]);

  async function onLogin() {
    setErr("");
    try {
      const res = await api.login(username.trim(), password);
      if (res.role !== "richie") throw new Error("Not a richie account");
      setToken(res.token);
      setTokenReady(true);
    } catch (e: any) {
      handleApiError(e, "Login failed");
    }
  }

  async function onLogout() {
    setErr("");
    try {
      await api.logout().catch(() => {});
    } finally {
      hardLogout();
    }
  }

  async function createDriver() {
    setErr("");
    const u = newUser.trim();
    const p = newPass.trim();
    if (!u) return setErr("Username required");
    if (!p || p.length < 4) return setErr("PIN/password must be at least 4 chars");

    setCreating(true);
    try {
      await api.createDriver(u, p);
      setNewUser("");
      setNewPass("");
      await loadUsers();
    } catch (e: any) {
      handleApiError(e, "Create driver failed");
    } finally {
      setCreating(false);
    }
  }

  async function toggleDisabled(user: UserRow) {
    setErr("");
    try {
      await api.setUserDisabled(user.id, !(user.disabled === 1));
      await loadUsers();
    } catch (e: any) {
      handleApiError(e, "Update user failed");
    }
  }

  function onLoginKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") onLogin();
  }

  function onRestaurantKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") createRestaurant();
  }

  if (!tokenReady) {
    return (
      <div style={styles.page}>
        <div style={styles.shell}>
          <div style={styles.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h1 style={styles.h1}>Richie Monitor</h1>
              <span style={styles.pill}>WEB</span>
            </div>
            <p style={styles.muted}>Login to view drivers + orders + manage accounts.</p>

            <div style={styles.row}>
              <input
                style={styles.input}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onKeyDown={onLoginKey}
              />
            </div>
            <div style={styles.row}>
              <input
                style={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                type="password"
                onKeyDown={onLoginKey}
              />
            </div>

            <button style={styles.btnPrimary} onClick={onLogin} type="button">
              Login
            </button>

            {err ? <div style={styles.err}>{err}</div> : null}

            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.8 }}>
              Demo: <b>richie / 9999</b>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topbar}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Richie Monitor</div>
            <div style={styles.mutedSmall}>{onlineCount} Staff Online</div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button style={styles.btnGhost} onClick={onLogout} type="button">
              Logout
            </button>
          </div>
        </div>

        <div style={styles.tabs}>
          <button style={styles.tabBtn(tab === "drivers")} onClick={() => setTab("drivers")} type="button">
            Drivers (Live)
          </button>
          <button style={styles.tabBtn(tab === "orders")} onClick={() => setTab("orders")} type="button">
            Active Orders
          </button>
          <button style={styles.tabBtn(tab === "users")} onClick={() => setTab("users")} type="button">
            Create Drivers
          </button>
          <button style={styles.tabBtn(tab === "restaurants")} onClick={() => setTab("restaurants")} type="button">
            Restaurants
          </button>

          <button style={styles.btnGhost} onClick={refresh} type="button" title="Manual refresh">
            Refresh
          </button>
        </div>

        {err ? <div style={styles.errWide}>{err}</div> : null}

        {tab === "drivers" ? (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Available (not busy)</div>
            {available.length === 0 ? (
              <div style={styles.muted}>No available staff</div>
            ) : (
              <div style={styles.list}>
                {available.map((s) => {
                  const stale = s.secondsAgo >= 30;
                  return (
                    <div key={s.username} style={styles.listItem}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div>
                          <b>{s.username}</b>{" "}
                          <span style={styles.mutedSmall}>
                            ({fmtAgo(s.secondsAgo)} ago){stale ? " • stale" : ""}
                          </span>
                        </div>
                        <span style={styles.badge("green")}>READY</span>
                      </div>
                      <div style={styles.mutedSmall}>
                        {s.lat != null && s.lng != null ? `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}` : "no GPS"}
                        {s.accuracy ? ` ±${Math.round(s.accuracy)}m` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ height: 14 }} />

            <div style={styles.panelTitle}>Busy</div>
            {busy.length === 0 ? (
              <div style={styles.muted}>No busy staff</div>
            ) : (
              <div style={styles.list}>
                {busy.map((s) => (
                  <div key={s.username} style={styles.listItem}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div>
                        <b>{s.username}</b> <span style={styles.badge("orange")}>BUSY</span>
                      </div>
                      <div style={styles.mutedSmall}>{fmtAgo(s.secondsAgo)} ago</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "orders" ? (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Active Orders ({orders.length})</div>
            {orders.length === 0 ? (
              <div style={styles.muted}>No active orders</div>
            ) : (
              <div style={styles.list}>
                {orders.map((o) => (
                  <div key={o.id} style={styles.listItem}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <b>{o.restaurantName}</b>
                      <span style={styles.badge("green")}>ACTIVE</span>
                    </div>

                    <div style={styles.mutedSmall}>
                      Driver: <b>{o.staffUsername || "-"}</b>
                    </div>
                    <div style={styles.mutedSmall}>To: {o.address}</div>

                    <div style={styles.mutedSmall}>
                      Fee: <b>{money(o.feeCents)}</b> {o.zone ? <span style={{ opacity: 0.7 }}>({o.zone})</span> : null}
                      {o.amountCents ? (
                        <>
                          {" "}
                          • Order: <b>{money(o.amountCents)}</b>
                        </>
                      ) : null}
                    </div>

                    {o.postalCode ? <div style={styles.mutedSmall}>Postal: {o.postalCode}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "users" ? (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Create Driver Account</div>

            <div style={styles.row}>
              <label style={styles.label}>Username</label>
              <input style={styles.input} value={newUser} onChange={(e) => setNewUser(e.target.value)} placeholder="e.g. mike" />
            </div>

            <div style={styles.row}>
              <label style={styles.label}>PIN / Password</label>
              <input style={styles.input} value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="4+ digits" />
            </div>

            <button style={styles.btnPrimary} onClick={createDriver} type="button" disabled={creating}>
              {creating ? "Creating..." : "Create Driver"}
            </button>

            <div style={{ height: 16 }} />

            <div style={styles.panelTitle}>Existing Drivers</div>
            {usersLoading ? (
              <div style={styles.muted}>Loading...</div>
            ) : users.length === 0 ? (
              <div style={styles.muted}>No drivers yet</div>
            ) : (
              <div style={styles.list}>
                {users.map((u) => (
                  <div key={u.id} style={styles.listItem}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div>
                        <b>{u.username}</b>{" "}
                        {u.disabled === 1 ? (
                          <span style={styles.badge("orange")}>DISABLED</span>
                        ) : (
                          <span style={styles.badge("green")}>ACTIVE</span>
                        )}
                      </div>
                      <button style={styles.btnGhost} type="button" onClick={() => toggleDisabled(u)}>
                        {u.disabled === 1 ? "Enable" : "Disable"}
                      </button>
                    </div>
                    <div style={styles.mutedSmall}>Role: {u.role}</div>
                    {u.createdBy ? <div style={styles.mutedSmall}>Created by: {u.createdBy}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "restaurants" ? (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Add Restaurant</div>

            <div style={styles.row}>
              <label style={styles.label}>Restaurant name</label>
              <input
                style={styles.input}
                value={restName}
                onChange={(e) => setRestName(e.target.value)}
                onKeyDown={onRestaurantKey}
                placeholder="e.g. Papa Joe’s"
              />
            </div>

            <button style={styles.btnPrimary} onClick={createRestaurant} type="button" disabled={restCreating}>
              {restCreating ? "Adding..." : "Add Restaurant"}
            </button>

            <div style={{ height: 16 }} />

            <div style={styles.panelTitle}>Existing Restaurants ({restaurants.length})</div>
            {restaurantsLoading ? (
              <div style={styles.muted}>Loading...</div>
            ) : restaurants.length === 0 ? (
              <div style={styles.muted}>No restaurants yet</div>
            ) : (
              <div style={styles.list}>
                {restaurants.map((r) => (
                  <div key={r.id} style={styles.listItem}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div>
                        <b>{r.name}</b>
                      </div>
                      <span style={styles.pill}>ID: {r.id}</span>
                    </div>
                    {r.createdBy ? <div style={styles.mutedSmall}>Created by: {r.createdBy}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const styles: any = {
  page: { minHeight: "100vh", background: "#0f1115", color: "white", padding: 18, fontFamily: "system-ui, Arial" },
  shell: { maxWidth: 1100, margin: "0 auto" },

  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 12,
    background: "#0f1115",
    borderBottom: "1px solid #1d2230",
  },

  tabs: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 },

  tabBtn: (active: boolean) => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: `1px solid ${active ? "#a855f7" : "#2b3142"}`,
    background: active ? "#2a143a" : "transparent",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  }),

  card: {
    width: 440,
    maxWidth: "95vw",
    background: "#151821",
    border: "1px solid #222736",
    borderRadius: 16,
    padding: 18,
  },

  h1: { margin: 0, fontSize: 28 },
  muted: { opacity: 0.75, marginTop: 8 },
  mutedSmall: { opacity: 0.7, fontSize: 12, marginTop: 4 },
  row: { marginTop: 10 },
  label: { display: "block", fontSize: 12, opacity: 0.8, marginBottom: 6 },

  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #2b3142",
    background: "#0f1115",
    color: "white",
  },

  btnPrimary: {
    marginTop: 12,
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "none",
    background: "#a855f7",
    color: "white",
    fontWeight: 900,
    cursor: "pointer",
  },

  btnGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #2b3142",
    background: "transparent",
    color: "white",
    cursor: "pointer",
  },

  panel: { background: "#151821", border: "1px solid #222736", borderRadius: 16, padding: 16 },
  panelTitle: { fontWeight: 900, marginBottom: 10 },

  list: { display: "grid", gap: 10 },
  listItem: { padding: 12, borderRadius: 14, border: "1px solid #222736", background: "#0f1115" },

  badge: (c: "green" | "orange") => ({
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: 12,
    background: c === "green" ? "#052e16" : "#2a1a06",
    border: `1px solid ${c === "green" ? "#16a34a" : "#f59e0b"}`,
    color: c === "green" ? "#86efac" : "#fcd34d",
  }),

  pill: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #2b3142",
    background: "#151821",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.9,
  },

  err: { marginTop: 12, color: "#f87171", fontWeight: 800, whiteSpace: "pre-wrap" },
  errWide: { marginBottom: 12, color: "#f87171", fontWeight: 900, whiteSpace: "pre-wrap" },
};
