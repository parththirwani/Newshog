// Client-safe fire-and-forget tracking. Server endpoint validates the name;
// never lets tracking break the UI.
export function trackClient(name: string, props?: Record<string, unknown>) {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, props }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break the UI
  }
}