// src/lib/api.ts

export type OnlineStaffItem = {
  id: string;
  name: string;
  online: boolean;
  lat?: number;
  lng?: number;
  accuracy?: number;
  lastPing?: number;
};

export type Order = {
  id: string;
  restaurant: string;
  address: string;
  cost?: number;
  status: "created" | "in_progress" | "completed";
  staffId?: string;
  staffName?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
};

export type Restaurant = {
  id: string;
  name: string;
};

const TOKEN_KEY = "richie_token";

// ---- token helpers (both Richie + Staff use these) ----
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// ---- localStorage keys ----
const LS_STAFF = "onlineStaff";
const LS_ORDERS = "orders";
const LS_RESTAURANTS = "restaurants";

// ---- simple id ----
function id() {
  return crypto.randomUUID();
}

// ---- API (frontend mock for now) ----
export const api = {
  // STAFF side
  staffPing(staffId: string, staffName: string, lat?: number, lng?: number, accuracy?: number) {
    const staff = this.getOnlineStaffAll();
    const now = Date.now();

    const next: OnlineStaffItem[] = [
      ...staff.filter(s => s.id !== staffId),
      { id: staffId, name: staffName, online: true, lat, lng, accuracy, lastPing: now },
    ];

    localStorage.setItem(LS_STAFF, JSON.stringify(next));
    return { ok: true, ts: now };
  },

  staffOffline(staffId: string) {
    const staff = this.getOnlineStaffAll();
    const next = staff.map(s => (s.id === staffId ? { ...s, online: false } : s));
    localStorage.setItem(LS_STAFF, JSON.stringify(next));
    return { ok: true };
  },

  // RICHIE side
  getOnlineStaffAll(): OnlineStaffItem[] {
    return JSON.parse(localStorage.getItem(LS_STAFF) || "[]");
  },

  getOnlineStaff(): OnlineStaffItem[] {
    return this.getOnlineStaffAll().filter(s => s.online);
  },

  // Restaurants
  getRestaurants(): Restaurant[] {
    return JSON.parse(localStorage.getItem(LS_RESTAURANTS) || "[]");
  },

  addRestaurant(name: string) {
    const restaurants = this.getRestaurants();
    const r = { id: id(), name: name.trim() };
    localStorage.setItem(LS_RESTAURANTS, JSON.stringify([r, ...restaurants]));
    return r;
  },

  deleteRestaurant(restaurantId: string) {
    const restaurants = this.getRestaurants().filter(r => r.id !== restaurantId);
    localStorage.setItem(LS_RESTAURANTS, JSON.stringify(restaurants));
    return { ok: true };
  },

  // Orders
  getOrders(): Order[] {
    return JSON.parse(localStorage.getItem(LS_ORDERS) || "[]");
  },

  createOrder(restaurant: string, address: string, cost?: number) {
    const orders = this.getOrders();
    const o: Order = {
      id: id(),
      restaurant: restaurant.trim(),
      address: address.trim(),
      cost: typeof cost === "number" ? cost : undefined,
      status: "created",
      createdAt: Date.now(),
    };
    localStorage.setItem(LS_ORDERS, JSON.stringify([o, ...orders]));
    return o;
  },

  startOrder(orderId: string, staffId: string, staffName: string) {
    const orders = this.getOrders().map(o =>
      o.id === orderId
        ? { ...o, status: "in_progress", staffId, staffName, startedAt: Date.now() }
        : o
    );
    localStorage.setItem(LS_ORDERS, JSON.stringify(orders));
    return { ok: true };
  },

  completeOrder(orderId: string) {
    const orders = this.getOrders().map(o =>
      o.id === orderId ? { ...o, status: "completed", completedAt: Date.now() } : o
    );
    localStorage.setItem(LS_ORDERS, JSON.stringify(orders));
    return { ok: true };
  },
};

// optional: seed some demo restaurants once
(function seed() {
  const existing = localStorage.getItem(LS_RESTAURANTS);
  if (!existing) {
    localStorage.setItem(
      LS_RESTAURANTS,
      JSON.stringify([
        { id: id(), name: "Famous Peppers" },
        { id: id(), name: "Taco Boys" },
        { id: id(), name: "China Garden" },
        { id: id(), name: "Hunters Ale House" },
      ])
    );
  }
})();
