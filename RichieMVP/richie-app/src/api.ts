console.log("VITE_API_URL", import.meta.env.VITE_API_URL);
console.log("VITE_AUTOCOMPLETE_BASE", import.meta.env.VITE_AUTOCOMPLETE_BASE);

export type Role = "staff" | "richie";

const API_URL = String(
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://68.183.197.69:5050"
).replace(/\/$/, "");

export const AUTOCOMPLETE_BASE = String(
  (import.meta.env.VITE_AUTOCOMPLETE_BASE as string | undefined) ?? API_URL
).replace(/\/$/, "");

// ================== TOKEN (IMPORTANT) ==================
// Richie app must NOT share token key with staff-app.
const TOKEN_KEY = "richie_token_v1";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// ================== ERROR ==================
export class ApiError extends Error {
  status: number; // 0 = network error
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

  if (opts.body !== undefined && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  if (token) headers.Authorization = `Bearer ${token}`;

  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

  let res: Response;
  try {
    res = await fetch(url, { ...opts, headers });
  } catch (e: any) {
    // This is where CORS / mixed-content / DNS / server down shows up.
    const msg = String(e?.message || e || "Network error");
    throw new ApiError(
      `Network error calling ${url}. If you see this only on POST, it's usually CORS preflight (OPTIONS) blocked. Details: ${msg}`,
      0,
      { url }
    );
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  let data: any = null;
  try {
    data = isJson ? await res.json() : await res.text();
  } catch {
    data = null;
  }

  if (!res.ok) {
    if (res.status === 401) clearToken();

    const message =
      (data && (data.error || data.message)) ||
      `HTTP ${res.status} ${res.statusText || ""}`.trim();

    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

// ================== HELPERS ==================
function normalizePostal3(raw: string) {
  const x = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return x.slice(0, 3);
}

// ================== TYPES ==================
export type Restaurant = {
  id: string;
  name: string;
  createdAt?: number | null;
  createdBy?: string | null;
  active?: number;
};

export type RestaurantsResponse = {
  restaurants: { id: string; name: string }[];
};

export type CreateRestaurantResponse = {
  ok: true;
  restaurant: Restaurant;
};

export type QuoteResponse = {
  feeCents: number;
  zone: string | null;
  postalCode?: string;
};

export type StaffOnlineResponse = {
  staff: {
    username: string;
    online: number;
    busy: number;
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    pingAt?: number | null;
  }[];
};

export type ActiveOrdersResponse = {
  orders: any[];
};

export type UserRow = {
  id: number;
  username: string;
  role: Role;
  disabled: number;
  createdAt?: number;
  createdBy?: string;
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

export type AddressAutocompleteResponse = {
  suggestions: AddressSuggestion[];
};

export type CreateOrderPayload = {
  restaurantId: string;
  address: string;
  amountCents?: number;
  postalCode?: string;
  feeCents?: number;
};

// ================== API ==================
export const api = {
  health: () => req<{ ok: boolean }>(API_URL, "/health"),

  login: (username: string, password: string) =>
    req<{ token: string; role: Role; username: string }>(API_URL, "/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  logout: () => req<{ ok: boolean }>(API_URL, "/auth/logout", { method: "POST" }),

  listRestaurants: () => req<RestaurantsResponse>(API_URL, "/restaurants"),

  createRestaurant: (name: string) =>
    req<CreateRestaurantResponse>(API_URL, "/restaurants", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  quote: (postalCode: string) =>
    req<QuoteResponse>(API_URL, "/quote?postalCode=" + encodeURIComponent(normalizePostal3(postalCode))),

  createOrder: (payload: CreateOrderPayload) =>
    req<{ order: any }>(API_URL, "/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  completeOrder: (orderId: string) =>
    req<{ ok: true; order: any }>(API_URL, `/orders/${encodeURIComponent(orderId)}/complete`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getOnlineStaff: () => req<StaffOnlineResponse>(API_URL, "/staff/online"),

  getActiveOrders: () => req<ActiveOrdersResponse>(API_URL, "/orders/active"),

  listUsers: (role?: Role) =>
    req<{ users: UserRow[] }>(API_URL, role ? `/admin/users?role=${encodeURIComponent(role)}` : "/admin/users"),

  createDriver: (username: string, password: string) =>
    req<{ ok: true; user: UserRow }>(API_URL, "/admin/users", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  setUserDisabled: (id: number, disabled: boolean) =>
    req<{ ok: true; user: UserRow }>(API_URL, `/admin/users/${id}/disable`, {
      method: "POST",
      body: JSON.stringify({ disabled }),
    }),

  addressAutocomplete: (q: string) =>
    req<AddressAutocompleteResponse>(AUTOCOMPLETE_BASE, "/api/address/autocomplete?q=" + encodeURIComponent(q)),
};
