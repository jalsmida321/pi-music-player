const ALLOWED_VIEWS = new Set(["library", "playlists", "repair", "chat", "settings"]);
const ALLOWED_PLAYER_ACTIONS = new Set(["toggle", "next", "previous"]);

export function parseDeepLink(raw) {
  if (typeof raw !== "string" || !raw.toLowerCase().startsWith("pimusic://")) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/+|\/+$/g, "").toLowerCase();
  if (host === "open" && ALLOWED_VIEWS.has(path)) return { type: "open", view: path };
  if (host === "play" && ALLOWED_PLAYER_ACTIONS.has(path)) return { type: "player", action: path };
  return null;
}

export function findDeepLink(argv) {
  return (Array.isArray(argv) ? argv : []).find((arg) => typeof arg === "string" && arg.toLowerCase().startsWith("pimusic://")) || null;
}
