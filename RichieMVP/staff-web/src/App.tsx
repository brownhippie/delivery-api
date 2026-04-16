import { useState } from "react";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);

  if (!loggedIn) {
    return (
      <div style={{ padding: 40 }}>
        <h1>Staff App</h1>
        <input placeholder="username" />
        <br />
        <input placeholder="pin" type="password" />
        <br />
        <button onClick={() => setLoggedIn(true)}>Login</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Staff Dashboard</h1>
      <p>Status: Online</p>
      <button>Create Order</button>
      <button>Go Offline</button>
    </div>
  );
}
