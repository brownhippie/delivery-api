import { useEffect, useRef, useState } from "react";
import { api, clearToken, getToken, setToken } from "./lib/api";
import { LogOut, MapPin, Power, Send } from "lucide-react";

export default function StaffApp() {
  const [tokenOk, setTokenOk] = useState<boolean>(!!getToken());
  const [username, setUsername] = useState("staff");
  const [pin, setPin] = useState("1111");
  const [err, setErr] = useState<string | null>(null);

  const [isOnline, setIsOnline] = useState(false);
  const pingTimer = useRef<number | null>(null);

  async function login() {
    try {
      setErr(null);
      const res = await api.login(username.trim(), pin.trim());
      if (res.user.role !== "STAFF") {
        setErr("This login is not a STAFF account");
        return;
      }
      setToken(res.token);
      setTokenOk(true);
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    }
  }

  function logout() {
    stopPings();
    clearToken();
    setTokenOk(false);
  }

  function stopPings() {
    if (pingTimer.current) window.clearInterval(pingTimer.current);
    pingTimer.current = null;
    setIsOnline(false);
  }

  async function goOffline() {
    try {
      await api["request" as any]; // ignore (ts)
    } catch {}
    try {
      // backend endpoint exists:
      await fetch(`${api.baseUrl}/staff/offline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
    } catch {}
    stopPings();
  }

  async function pingOnce() {
    if (!navigator.geolocation) {
      setErr("Geolocation not supported on this device/browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setErr(null);
          const { latitude, longitude, accuracy } = pos.coords;
          const res = await fetch(`${api.baseUrl}/staff/ping`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify({ latitude, longitude, accuracy }),
          });

          if (res.status === 401) {
            setErr("Invalid token");
            clearToken();
            setTokenOk(false);
            return;
          }
          if (!res.ok) {
            setErr(`Ping failed (${res.status})`);
          }
        } catch (e: any) {
          setErr(e?.message || "Ping error");
        }
      },
      (geoErr) => {
        setErr(geoErr.message || "Location error");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  async function goOnline() {
    setErr(null);
    setIsOnline(true);

    // immediate ping + every 10s
    await pingOnce();
    pingTimer.current = window.setInterval(pingOnce, 10000);
  }

  useEffect(() => {
    // cleanup
    return () => {
      if (pingTimer.current) window.clearInterval(pingTimer.current);
    };
  }, []);

  if (!tokenOk) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h2>Staff App</h2>
        <p style={{ color: "#666" }}>Login, then go Online to send GPS pings</p>

        <div style={{ display: "grid", gap: 12, maxWidth: 320 }}>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="pin" />
          <button onClick={login}>Login</button>
          {err && <div style={{ color: "crimson" }}>{err}</div>}
          <div style={{ color: "#666", fontSize: 12 }}>
            API: {api.baseUrl} <br />
            Demo: staff / 1111
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <div style={{ background: "#2563eb", color: "white", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700 }}>Staff App</div>
          <div style={{ opacity: 0.9, fontSize: 12 }}>{isOnline ? "ONLINE" : "OFFLINE"}</div>
        </div>

        <button onClick={logout} style={{ background: "rgba(255,255,255,0.15)", color: "white", border: 0, padding: "8px 10px", borderRadius: 10, cursor: "pointer" }}>
          <LogOut size={16} />
        </button>
      </div>

      <div style={{ padding: 16 }}>
        {err && <div style={{ color: "crimson", marginBottom: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!isOnline ? (
            <button onClick={goOnline} style={{ padding: "10px 12px", display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Power size={16} /> Go Online (start GPS)
            </button>
          ) : (
            <button onClick={goOffline} style={{ padding: "10px 12px", display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Power size={16} /> Go Offline
            </button>
          )}

          <button onClick={pingOnce} style={{ padding: "10px 12px", display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Send size={16} /> Ping Now
          </button>

          <button
            onClick={() => window.open("https://www.google.com/maps", "_blank")}
            style={{ padding: "10px 12px", display: "inline-flex", gap: 8, alignItems: "center" }}
          >
            <MapPin size={16} /> Open Maps
          </button>
        </div>

        <div style={{ marginTop: 14, color: "#666", fontSize: 12 }}>
          This app only needs foreground GPS. Keep the browser tab open while online.
        </div>
      </div>
    </div>
  );
}
