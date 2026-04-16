import { useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, setToken, OnlineStaffItem, Order, Restaurant } from "./lib/api";
import { LogOut, RefreshCw, Settings, Users, ClipboardList, Plus, Trash2 } from "lucide-react";

type Tab = "available" | "orders" | "settings";

function nowAgo(ts: number) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export default function RichieApp() {
  const [tab, setTab] = useState<Tab>("available");
  const [tokenOk, setTokenOk] = useState<boolean>(!!getToken());
  const [username, setUsername] = useState("richie");
  const [pin, setPin] = useState("9999");
  const [err, setErr] = useState<string | null>(null);

  const [online, setOnline] = useState<OnlineStaffItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  // order form
  const [orderRestaurant, setOrderRestaurant] = useState("");
  const [orderAddress, setOrderAddress] = useState("");
  const [orderCost, setOrderCost] = useState<number>(15); // cents or dollars? you decide in UI; backend uses number.

  // settings: rate (stored locally for now; if you want it in DB we’ll add a table)
  const [rate, setRate] = useState<number>(() => {
    const v = localStorage.getItem("richie_rate");
    return v ? Number(v) : 0.15;
  });

  async function refreshAll() {
    try {
      setErr(null);
      const [s, o, r] = await Promise.all([api.onlineStaff(), api.orders(), api.restaurants()]);
      setOnline(s.online);
      setOrders(o.orders);
      setRestaurants(r.restaurants);
      setLastUpdate(Date.now());
    } catch (e: any) {
      if (e?.message === "INVALID_TOKEN") {
        setErr("Invalid token");
        clearToken();
        setTokenOk(false);
        return;
      }
      setErr(e?.message || "Error");
    }
  }

  useEffect(() => {
    if (!tokenOk) return;
    refreshAll();
    const t = setInterval(refreshAll, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenOk]);

  const created = useMemo(() => orders.filter(o => o.status === "created"), [orders]);
  const inProgress = useMemo(() => orders.filter(o => o.status === "in_progress"), [orders]);
  const completed = useMemo(() => orders.filter(o => o.status === "completed").slice(0, 10), [orders]);

  async function login() {
    try {
      setErr(null);
      const res = await api.login(username.trim(), pin.trim());
      if (res.user.role !== "RICHIE") {
        setErr("This login is not a RICHIE account");
        return;
      }
      setToken(res.token);
      setTokenOk(true);
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    }
  }

  function logout() {
    clearToken();
    setTokenOk(false);
  }

  async function addRestaurant() {
    const name = prompt("Restaurant name?");
    if (!name?.trim()) return;
    await api.addRestaurant(name.trim());
    await refreshAll();
  }

  async function deleteRestaurant(id: string) {
    if (!confirm("Delete restaurant?")) return;
    await api.deleteRestaurant(id);
    await refreshAll();
  }

  async function createOrder() {
    if (!orderRestaurant.trim() || !orderAddress.trim()) {
      setErr("Restaurant + address required");
      return;
    }
    await api.createOrder(orderRestaurant.trim(), orderAddress.trim(), Number(orderCost) || 0);
    setOrderAddress("");
    await refreshAll();
    setTab("orders");
  }

  async function assign(orderId: string, staffId: string) {
    await api.startOrder(orderId, staffId);
    await refreshAll();
  }

  async function complete(orderId: string) {
    await api.completeOrder(orderId);
    await refreshAll();
  }

  function saveRate() {
    localStorage.setItem("richie_rate", String(rate));
    alert("Saved (local only for now). If you want it stored in the API DB, say so.");
  }

  if (!tokenOk) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2>Richie Monitor</h2>
        <p style={{ color: "#666" }}>Login to use the Richie app</p>

        <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="pin" />
          <button onClick={login}>Login</button>
          {err && <div style={{ color: "crimson" }}>{err}</div>}
          <div style={{ color: "#666", fontSize: 12 }}>
            API: {api.baseUrl} <br />
            Demo: richie / 9999
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <div style={{ background: "#7c3aed", color: "white", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Richie Monitor</div>
          <div style={{ opacity: 0.9, fontSize: 12 }}>{online.length} Staff Online</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={refreshAll} title="Refresh" style={{ background: "rgba(255,255,255,0.15)", color: "white", border: 0, padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={logout} title="Logout" style={{ background: "rgba(255,255,255,0.15)", color: "white", border: 0, padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
            <LogOut size={16} />
          </button>
        </div>
      </div>

      <div style={{ padding: 12, display: "flex", gap: 10, borderBottom: "1px solid #eee" }}>
        <button onClick={() => setTab("available")} style={{ padding: "10px 12px" }}>
          <Users size={16} /> Available ({online.length})
        </button>
        <button onClick={() => setTab("orders")} style={{ padding: "10px 12px" }}>
          <ClipboardList size={16} /> Orders
        </button>
        <button onClick={() => setTab("settings")} style={{ padding: "10px 12px" }}>
          <Settings size={16} /> Settings
        </button>

        <div style={{ marginLeft: "auto", opacity: 0.7, fontSize: 12, display: "flex", alignItems: "center" }}>
          Updated {lastUpdate ? `${nowAgo(lastUpdate)} ago` : "—"}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

        {tab === "available" && (
          <div style={{ display: "grid", gap: 12 }}>
            <h3>Online Staff</h3>
            {online.length === 0 ? (
              <div style={{ color: "#666" }}>No staff online</div>
            ) : (
              online.map((s) => (
                <div key={s.user.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{s.user.username}</div>
                  <div style={{ color: "#666", fontSize: 12 }}>
                    {s.location
                      ? `Last ping ${nowAgo(s.location.timestamp)} ago • (${s.location.latitude.toFixed(5)}, ${s.location.longitude.toFixed(5)}) ±${Math.round(s.location.accuracy)}m`
                      : "No location yet"}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "orders" && (
          <div style={{ display: "grid", gap: 16 }}>
            <h3>Create Order</h3>
            <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                value={orderRestaurant}
                onChange={(e) => setOrderRestaurant(e.target.value)}
                placeholder="Restaurant name (or pick from Settings)"
              />
              <input value={orderAddress} onChange={(e) => setOrderAddress(e.target.value)} placeholder="Delivery address" />
              <input
                type="number"
                value={orderCost}
                onChange={(e) => setOrderCost(Number(e.target.value))}
                placeholder="Cost"
              />
              <button onClick={createOrder} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Plus size={16} /> Create
              </button>
            </div>

            <div>
              <h3>Created (unassigned)</h3>
              {created.length === 0 ? (
                <div style={{ color: "#666" }}>None</div>
              ) : (
                created.map((o) => (
                  <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700 }}>{o.restaurantName}</div>
                    <div style={{ color: "#666" }}>{o.deliveryAddress}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>Cost: {o.cost}</div>

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, marginBottom: 6, opacity: 0.7 }}>Assign to:</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {online.length === 0 ? (
                          <span style={{ color: "#666" }}>No staff online</span>
                        ) : (
                          online.map((s) => (
                            <button key={s.user.id} onClick={() => assign(o.id, s.user.id)}>
                              {s.user.username}
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <h3>Active (in progress)</h3>
              {inProgress.length === 0 ? (
                <div style={{ color: "#666" }}>None</div>
              ) : (
                inProgress.map((o) => (
                  <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                    <div style={{ fontWeight: 700 }}>{o.restaurantName}</div>
                    <div style={{ color: "#666" }}>{o.deliveryAddress}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>
                      Staff: {o.staffName || "—"} • Started: {o.startedAt ? nowAgo(o.startedAt) + " ago" : "—"}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <button onClick={() => complete(o.id)}>Mark Completed</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div>
              <h3>Recent Completed</h3>
              {completed.length === 0 ? (
                <div style={{ color: "#666" }}>None</div>
              ) : (
                completed.map((o) => (
                  <div key={o.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 700 }}>{o.restaurantName}</div>
                    <div style={{ color: "#666", fontSize: 12 }}>
                      {o.deliveryAddress} • {o.completedAt ? nowAgo(o.completedAt) + " ago" : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div style={{ display: "grid", gap: 18, maxWidth: 700 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <h3>Rate (Richie can change)</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="number"
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                  style={{ width: 140 }}
                />
                <button onClick={saveRate}>Save</button>
              </div>
              <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>
                Currently saved locally in this browser. If you want this stored in the backend DB, we add a table + endpoint.
              </div>
            </div>

            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3>Restaurants</h3>
                <button onClick={addRestaurant} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                  <Plus size={16} /> Add
                </button>
              </div>

              {restaurants.length === 0 ? (
                <div style={{ color: "#666" }}>None</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {restaurants.map((r) => (
                    <div key={r.id} style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>{r.name}</div>
                      <button onClick={() => deleteRestaurant(r.id)} title="Delete" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ color: "#666", fontSize: 12 }}>
              API: {api.baseUrl}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
