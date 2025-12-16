import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import sqlite3 from "sqlite3";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const PORT = process.env.PORT || 5050;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DB_PATH = process.env.DB_PATH || "./delivery.db";
const RATE_CENTS = Number(process.env.RATE_CENTS || 15);

const db = new sqlite3.Database(DB_PATH);

// ---------- DB helpers ----------
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('staff','richie'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS staff_status (
      username TEXT PRIMARY KEY,
      online INTEGER NOT NULL DEFAULT 0,
      busy INTEGER NOT NULL DEFAULT 0,
      last_lat REAL,
      last_lng REAL,
      last_accuracy REAL,
      last_ping_at INTEGER
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      staff_username TEXT,
      restaurant_id TEXT NOT NULL,
      restaurant_name TEXT NOT NULL,
      address TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','completed')) DEFAULT 'active',
      completed_at INTEGER
    )
  `);

  // seed demo users
  const staff = await get(`SELECT username FROM users WHERE username=?`, ["john"]);
  if (!staff) {
    await run(
      `INSERT INTO users(username,password_hash,role) VALUES (?,?,?)`,
      ["john", bcrypt.hashSync("1234", 10), "staff"]
    );
    await run(
      `INSERT INTO users(username,password_hash,role) VALUES (?,?,?)`,
      ["sarah", bcrypt.hashSync("5678", 10), "staff"]
    );
    await run(
      `INSERT INTO users(username,password_hash,role) VALUES (?,?,?)`,
      ["richie", bcrypt.hashSync("9999", 10), "richie"]
    );
  }

  // seed restaurants
  const r = await get(`SELECT id FROM restaurants LIMIT 1`);
  if (!r) {
    const seed = [
      ["china-garden", "China Garden"],
      ["pizza-palace", "Pizza Palace"],
      ["donair-spot", "Donair Spot"],
      ["thai-house", "Thai House"],
    ];
    for (const [id, name] of seed) {
      await run(`INSERT INTO restaurants(id,name) VALUES (?,?)`, [id, name]);
    }
  }
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

// ---------- routes your frontend expects ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/config", (_req, res) => res.json({ rateCents: RATE_CENTS }));

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "missing creds" });

  const u = await get(`SELECT username,password_hash,role FROM users WHERE username=?`, [username]);
  if (!u) return res.status(401).json({ error: "bad creds" });

  const ok = bcrypt.compareSync(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: "bad creds" });

  const token = signToken({ username: u.username, role: u.role });
  res.json({ token, role: u.role, username: u.username });
});

app.post("/auth/logout", (_req, res) => res.json({ ok: true }));

app.get("/restaurants", async (_req, res) => {
  const restaurants = await all(`SELECT id,name FROM restaurants ORDER BY name`);
  res.json({ restaurants });
});

// staff: online toggle
app.post("/staff/online", auth, requireRole("staff"), async (req, res) => {
  const { online } = req.body || {};
  const username = req.user.username;

  await run(
    `INSERT INTO staff_status(username,online,busy) VALUES (?,?,0)
     ON CONFLICT(username) DO UPDATE SET online=excluded.online`,
    [username, online ? 1 : 0]
  );

  res.json({ ok: true, online: !!online });
});

// staff: gps ping
app.post("/staff/ping", auth, requireRole("staff"), async (req, res) => {
  const { lat, lng, accuracy } = req.body || {};
  const username = req.user.username;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat/lng required" });
  }
  const now = Date.now();

  await run(
    `INSERT INTO staff_status(username,online,busy,last_lat,last_lng,last_accuracy,last_ping_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(username) DO UPDATE SET
       last_lat=excluded.last_lat,
       last_lng=excluded.last_lng,
       last_accuracy=excluded.last_accuracy,
       last_ping_at=excluded.last_ping_at`,
    [username, 1, 0, lat, lng, accuracy ?? null, now]
  );

  res.json({ ok: true });
});

// create order
app.post("/orders", auth, requireRole("staff"), async (req, res) => {
  const { restaurantId, address, amountCents } = req.body || {};
  if (!restaurantId || !address) return res.status(400).json({ error: "missing fields" });
  const amount = Number(amountCents || 0);

  const rest = await get(`SELECT id,name FROM restaurants WHERE id=?`, [restaurantId]);
  if (!rest) return res.status(400).json({ error: "invalid restaurant" });

  const id = `ord_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const now = Date.now();

  await run(
    `INSERT INTO orders(id,created_at,created_by,staff_username,restaurant_id,restaurant_name,address,amount_cents,status)
     VALUES (?,?,?,?,?,?,?,?, 'active')`,
    [id, now, req.user.username, req.user.username, rest.id, rest.name, address, amount]
  );

  // mark staff busy
  await run(
    `INSERT INTO staff_status(username,online,busy) VALUES (?,?,1)
     ON CONFLICT(username) DO UPDATE SET busy=1, online=1`,
    [req.user.username, 1]
  );

  const order = await get(`SELECT * FROM orders WHERE id=?`, [id]);
  res.json({ order });
});

// complete order
app.post("/orders/:id/complete", auth, requireRole("staff"), async (req, res) => {
  const id = req.params.id;
  const o = await get(`SELECT * FROM orders WHERE id=?`, [id]);
  if (!o) return res.status(404).json({ error: "order not found" });

  await run(`UPDATE orders SET status='completed', completed_at=? WHERE id=?`, [Date.now(), id]);

  // mark staff not busy
  await run(
    `INSERT INTO staff_status(username,online,busy) VALUES (?,?,0)
     ON CONFLICT(username) DO UPDATE SET busy=0`,
    [req.user.username, 1]
  );

  const order = await get(`SELECT * FROM orders WHERE id=?`, [id]);
  res.json({ ok: true, order });
});

// ---- Richie monitor endpoints (you were missing these) ----
app.get("/staff/online", auth, requireRole("richie"), async (_req, res) => {
  const staff = await all(
    `SELECT username, online, busy, last_lat as lat, last_lng as lng, last_accuracy as accuracy, last_ping_at as pingAt
     FROM staff_status
     WHERE online=1
     ORDER BY busy ASC, username ASC`
  );
  res.json({ staff });
});

app.get("/orders/active", auth, requireRole("richie"), async (_req, res) => {
  const orders = await all(
    `SELECT * FROM orders WHERE status='active' ORDER BY created_at DESC LIMIT 200`
  );
  res.json({ orders });
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
