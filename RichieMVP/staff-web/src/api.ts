export type UserRole = "RICHIE" | "STAFF";

export type LoginResponse = {
  token: string;
  user: { id: string; username: string; role: UserRole };
};

export type OnlineStaffItem = {
  user: { id: string; username: string };
  location: null | {
    timestamp: number;
    latitude: number;
    longitude: number;
    accuracy: number;
  };
};

export type Restaurant = { id: string; name: string };

export type OrderStatus = "created" | "in_progress" | "completed";

export type Order = {
  id: string;
  restaurantName: string;
  deliveryAddress: string;
  cost: number;
  status: OrderStatus;
  staffId?: string | null;
  staffName?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
};

const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.toString()?.trim() || "http://localhost:5050";

const TOKEN_KEY = "auth_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });

  if (res.status === 401) throw new Error("INVALID_TOKEN");
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP_${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  baseUrl: API_BASE,

  async login(username: string, pin: string) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, pin }),
    });
  },

  async onlineStaff() {
    return request<{ online: OnlineStaffItem[] }>("/richie/online-staff");
  },

  async restaurants() {
    return request<{ restaurants: Restaurant[] }>("/restaurants");
  },

  async addRestaurant(name: string) {
    return request<{ restaurant: Restaurant }>("/restaurants", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  async deleteRestaurant(id: string) {
    return request<{ ok: true }>(`/restaurants/${id}`, { method: "DELETE" });
  },

  async orders() {
    return request<{ orders: Order[] }>("/orders");
  },

  async createOrder(restaurantName: string, deliveryAddress: string, cost: number) {
    return request<{ order: Order }>("/orders", {
      method: "POST",
      body: JSON.stringify({ restaurantName, deliveryAddress, cost }),
    });
  },

  async startOrder(orderId: string, staffId: string) {
    return request<{ ok: true }>(`/orders/${orderId}/start`, {
      method: "POST",
      body: JSON.stringify({ staffId }),
    });
  },

  async completeOrder(orderId: string) {
    return request<{ ok: true }>(`/orders/${orderId}/complete`, {
      method: "POST",
    });
  },

  async setOrderCost(orderId: string, cost: number) {
    return request<{ ok: true }>(`/orders/${orderId}/cost`, {
      method: "PATCH",
      body: JSON.stringify({ cost }),
    });
  },
};
