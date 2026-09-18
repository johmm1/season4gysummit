export const CONFIG = {
  // Auto-detects environment instead of needing a manual edit before every
  // deploy (that manual-edit step is exactly the kind of thing that gets
  // forgotten). Anything not on localhost/127.0.0.1 is treated as
  // production and must be told the real backend URL — bake it in below
  // once you know your Railway URL (Settings > Networking > Generate
  // Domain, e.g. gy-summit-2026-api-production.up.railway.app).
  API_BASE_URL: (() => {
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (isLocal) return "http://localhost:4000/api";

    // ---> Set this to your deployed Railway backend's URL once you have it <---
    const PRODUCTION_API_URL = "https://your-backend.up.railway.app/api";
    return PRODUCTION_API_URL;
  })(),
  APP_NAME: "GY Summit 2026",
  VERSION: "1.0.0",
  REQUEST_TIMEOUT: 30000,

  // Google Identity Services needs this in the browser (it's the public
  // Client ID, safe to expose — not a secret, unlike the backend having
  // its own copy of the same value to verify tokens with). Leave blank
  // to keep the "Continue with Google" button hidden.
  GOOGLE_CLIENT_ID: "",

  EVENT: {
    name: "GY Summit 2026",
    startDate: "2026-12-27T09:00:00+03:00",
    endDate: "2026-12-31T17:00:00+03:00",
    venue: "PCEA Githunguri Presbytery Grounds, Githunguri, Kiambu County",
  },
};

export function apiUrl(path = "") {
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return CONFIG.API_BASE_URL + path;
}