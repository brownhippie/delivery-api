console.log("VITE_API_URL", import.meta.env.VITE_API_URL);
console.log("VITE_AUTOCOMPLETE_BASE", import.meta.env.VITE_AUTOCOMPLETE_BASE);

export type Role = "staff" | "richie";

// normalize base URL once
const API_URL = String(import.meta.env.VITE_API_URL || "http://68.183.197.69:5050").replace(/\/$/, "");

// If you run autocomplete proxy somewhere else, set VITE_AUTOCOMPLETE_BASE
// If you run it in the SAME backend, leave it empty and it will default to API_URL.
export const AUTOCOMPLETE_BASE = String(import.meta.env.VITE_AUTOCOMPLETE_BASE || API_URL).replace(/\/$/, "");

// ================== TOKEN ==================
export function getToken() {
  return localStorage.getItem("token") || "";
}
export function setToken(t: string) {
  localStorage.setItem("token", t);
}
export function clearToken() {
  localStorage.removeItem("token");
}

// ================== ERROR ==================
export class ApiError extends Error {
  status: number;
  payload: any;
  constructor(message: string, status: number, payload: any) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

// ================== REQUEST CORE ==================
async function req<T>(base: string, path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers as any),
  };

  // auto JSON content-type when body exists
  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, { ...opts, headers });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let data: any = null;
  try {
    data = isJson ? await res.json() : await res.text();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}

// ================== HELPERS ==================
function normalizePostal(raw: string) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePostal3(raw: string) {
  return normalizePostal(raw).slice(0, 3);
}

// ================== TYPES ==================
export type RestaurantsResponse = { restaurants: { id: string; name: string }[] };

export type QuoteResponse = {
  feeCents: number;
  zone: string | null;
  postalCode?: string; // server returns prefix
};

export type RateRow = {
  postalPrefix: string; // "C1A"
  zone: string | null;
  feeCents: number;
  updatedAt: number;
};
export type RatesResponse = { rates: RateRow[] };
export type UpsertRateResponse = { ok: true; rate: RateRow };

export type RunOrderRow = {
  id: string;
  createdAt: number;
  completedAt: number | null;
  restaurantName: string;
  address: string;
  postalCode: string;
  zone: string | null;
  feeCents: number;
  status: "active" | "completed";
};

export type RunsResponse = {
  date: string; // YYYY-MM-DD
  totals: {
    orders: number;
    completed: number;
    active: number;
    totalFeeCents: number;
  };
  orders: RunOrderRow[];
};

export type AddressSuggestion = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  postcode: string | null;
  countrycode: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
};
export type AddressAutocompleteResponse = { suggestions: AddressSuggestion[] };

export type CreateOrderPayload = {
  restaurantId: string;
  address: string;
  amountCents?: number;
  postalCode?: string;
  feeCents?: number;
  zone?: string | null; // optional, backend accepts it (but derives if missing)
};

// ================== API ==================
export const api = {
  // health (REAL)
  health: () => req<{ ok: boolean }>(API_URL, "/health"),

  // auth
  login: (username: string, password: string) =>
    req<{ token: string; role: Role; username: string }>(API_URL, "/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => req<{ ok: boolean }>(API_URL, "/auth/logout", { method: "POST" }),

  // restaurants
  listRestaurants: () => req<RestaurantsResponse>(API_URL, "/restaurants"),

  // staff online
  setOnline: (online: boolean) =>
    req<{ ok: true; online: boolean }>(API_URL, "/staff/online", {
      method: "POST",
      body: JSON.stringify({ online }),
    }),

  // staff ping (REAL)
  ping: (lat: number, lng: number, accuracy?: number) =>
    req<{ ok: true }>(API_URL, "/staff/ping", {
      method: "POST",
      body: JSON.stringify({ lat, lng, accuracy }),
    }),

  // quote (auth required)
  quote: (postalCode: string) =>
    req<QuoteResponse>(API_URL, "/quote?postalCode=" + encodeURIComponent(normalizePostal3(postalCode))),

  // orders
  createOrder: (payload: CreateOrderPayload) =>
    req<{ order: any }>(API_URL, "/orders", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        postalCode: payload.postalCode ? normalizePostal(payload.postalCode) : payload.postalCode,
      }),
    }),

  completeOrder: (orderId: string) =>
    req<{ ok: true; order: any }>(API_URL, `/orders/${encodeURIComponent(orderId)}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // rates
  listRates: () => req<RatesResponse>(API_URL, "/rates"),

  upsertRate: (postalPrefix: string, feeCents: number, zone?: string | null) =>
    req<UpsertRateResponse>(API_URL, "/rates", {
      method: "POST",
      body: JSON.stringify({
        postalPrefix: normalizePostal3(postalPrefix),
        feeCents,
        zone: zone ?? null,
      }),
    }),

  // runs
  staffRuns: (dateISO: string) => req<RunsResponse>(API_URL, "/staff/runs?date=" + encodeURIComponent(dateISO)),

  // autocomplete (PUBLIC)
  addressAutocomplete: (q: string) =>
    req<AddressAutocompleteResponse>(AUTOCOMPLETE_BASE, "/api/address/autocomplete?q=" + encodeURIComponent(q)),
};
