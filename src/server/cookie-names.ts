// Cookies are scoped by host/path, not port. Keep the 3210 application's names intact.
export const sessionCookieName = () =>
  process.env.ORBIT_LOCAL_INSTANCE === "codex"
    ? "orbit_codex_session"
    : "orbit_session";
export const gscCookieName = () =>
  process.env.ORBIT_LOCAL_INSTANCE === "codex"
    ? "orbit_codex_gsc_oauth"
    : "orbit_gsc_oauth";
