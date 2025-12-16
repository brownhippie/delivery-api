import express from "express";
import cors from "cors";
import crypto from "crypto";

type Role = "staff" | "richie";

type Session = { token: string; role: Role; username: string };
type Restaurant = { id: string; name: string; createdAt: number };

type StaffState = {
  username: string;
  online: boolean;
  lastSeen: number;
  lat?: number;
  lng?: number;
  accuracy?: number;
  activeOrderId?: string | null;
};

type OrderStatus = "in_progress" | "completed";

type Order = {
  id: string;
  createdAt: number;
  staffUsername: string;
  restaurantId: string;
  restaurantName: string;
  address: string;
  amountCents: number;
  feeCents: number;
  status: OrderStatus;
  completedAt?: number;
};

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 5050);
const HOST = process.env.HOST || "0.0.0.0";

const users: Array<{ username: string; password: string; role: Role }> = [
  { username: "staff", password: "1111", role: "staff" },
  { username: "john", password: "1234", role: "staff" },
  { username: "sarah", password: "5678", role: "staff" },
  { username: "richie", password: "9999", role: "richie" }
];

let rateCents = 15; // Richie can change this (15 cents per delivery)

const sessions = new Map<string, Session>();
const staff = new Map<string, StaffState>();
const restaurants = new Map<string, Restaurant>();
const orders = new Map<string, Order>();

function seed() {
  if (restaurants.size === 0) {
    const names = ["Famous Peppers", "Taco Boys", "China Garden", "Hunters Ale House"];
    for (const name of names) {
      const id = crypto.randomUUID();
      restaurants.set(id, { id, name, createdAt: Date.now() });
    }
  }
  for (const u of users.filter(u => u.role === "staff")) {
    if (!staff.has(u.username)) {
      staff.set(u.username, {
        username: u.username,
        online: false,
        lastSeen: 0,
        activeOrderId: null
      });
    }
  }
}
seed();

function auth(req: express.Request): Session | null {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireRole(role: Role) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const s = auth(req);
    if (!s) return res.status(401).json({ error: "Unauthorized" });
    if (s.role !== role) return res.status(403).json({ error: "Forbidden" });
    (req as any).session = s;
    next();
  };
}

app.get("/health", (_, res) => res.json({ ok: true }));

// ---------- AUTH ----------
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const u = users.find(x => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ error: "Invalid credentials" });

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { token, role: u.role, username: u.username });

  // ensure staff state exists
  if (u.role === "staff" && !staff.has(u.username)) {
    staff.set(u.username, { username: u.username, online: false, lastSeen: 0, activeOrderId: null });
  }

  return res.json({ token, role: u.role, username: u.username });
});

app.post("/auth/logout", (req, res) => {
  const s = auth(req);
  if (s) sessions.delete(s.token);
  res.json({ ok: true });
});

// ---------- CONFIG (RATE) ----------
app.get("/config", (_, res) => {
  res.json({ rateCents });
});

app.put("/config", requireRole("richie"), (req, res) => {
  const { rateCents: rc } = req.body || {};
  const n = Number(rc);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return res.status(400).json({ error: "Bad rate" });
  rateCents = Math.round(n);
  res.json({ rateCents });
});

// ---------- RESTAURANTS ----------
app.get("/restaurants", (_, res) => {
  res.json({ restaurants: Array.from(restaurants.values()).sort((a, b) => a.name.localeCompare(b.name)) });
});

app.post("/restaurants", requireRole("richie"), (req, res) => {
  const { name } = req.body || {};
  const clean = String(name || "").trim();
  if (!clean) return res.status(400).json({ error: "Name required" });

  const id = crypto.randomUUID();
  const r: Restaurant = { id, name: clean, createdAt: Date.now() };
  restaurants.set(id, r);
  res.json({ restaurant: r });
});

app.delete("/restaurants/:id", requireRole("richie"), (req, res) => {
  const id = req.params.id;
  if (!restaurants.has(id)) return res.status(404).json({ error: "Not found" });
  restaurants.delete(id);
  res.json({ ok: true });
});

// ---------- STAFF ONLINE + GPS ----------
app.get("/staff/online", requireRole("richie"), (_req, res) => {
  const now = Date.now();
  const list = Array.from(staff.values())
    .filter(s => s.online)
    .map(s => ({
      username: s.username,
      lastSeen: s.lastSeen,
      secondsAgo: Math.max(0, Math.floor((now - s.lastSeen) / 1000)),
      lat: s.lat,
      lng: s.lng,
      accuracy: s.accuracy,
      busy: !!s.activeOrderId
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
  res.json({ staff: list });
});

app.post("/staff/online", requireRole("staff"), (req, res) => {
  const sess = (req as any).session as Session;
  const st = staff.get(sess.username)!;
  const { online } = req.body || {};
  st.online = !!online;
  st.lastSeen = Date.now();
  if (!st.online) st.activeOrderId = null;
  staff.set(sess.username, st);
  res.json({ ok: true, online: st.online });
});

app.post("/staff/ping", requireRole("staff"), (req, res) => {
  const sess = (req as any).session as Session;
  const st = staff.get(sess.username)!;
  const { lat, lng, accuracy } = req.body || {};
  st.lastSeen = Date.now();
  st.lat = Number(lat);
  st.lng = Number(lng);
  st.accuracy = accuracy == null ? undefined : Number(accuracy);
  staff.set(sess.username, st);
  res.json({ ok: true });
});

// ---------- ORDERS ----------
app.get("/orders/active", requireRole("richie"), (_req, res) => {
  const active = Array.from(orders.values())
    .filter(o => o.status === "in_progress")
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ orders: active });
});

app.post("/orders", requireRole("staff"), (req, res) => {
  const sess = (req as any).session as Session;
  const st = staff.get(sess.username)!;

  if (!st.online) return res.status(400).json({ error: "You must be online to create an order" });
  if (st.activeOrderId) return res.status(400).json({ error: "You already have an active order" });

  const { restaurantId, address, amountCents } = req.body || {};
  const rid = String(restaurantId || "");
  const r = restaurants.get(rid);
  if (!r) return res.status(400).json({ error: "Invalid restaurant" });

  const addr = String(address || "").trim();
  if (!addr) return res.status(400).json({ error: "Address required" });

  const amt = Math.max(0, Math.round(Number(amountCents || 0)));
  const fee = rateCents;

  const o: Order = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    staffUsername: sess.username,
    restaurantId: r.id,
    restaurantName: r.name,
    address: addr,
    amountCents: amt,
    feeCents: fee,
    status: "in_progress"
  };

  orders.set(o.id, o);
  st.activeOrderId = o.id;
  staff.set(sess.username, st);

  res.json({ order: o });
});

app.post("/orders/:id/complete", requireRole("staff"), (req, res) => {
  const sess = (req as any).session as Session;
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: "Not found" });
  if (o.staffUsername !== sess.username) return res.status(403).json({ error: "Not your order" });
  if (o.status !== "in_progress") return res.status(400).json({ error: "Already completed" });

  o.status = "completed";
  o.completedAt = Date.now();
  orders.set(o.id, o);

  const st = staff.get(sess.username);
  if (st && st.activeOrderId === o.id) {
    st.activeOrderId = null;
    staff.set(sess.username, st);
  }

  res.json({ ok: true, order: o });
});

app.listen(PORT, HOST, () => {
  console.log(`API running on http://${HOST}:${PORT}`);
});
