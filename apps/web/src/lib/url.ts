const TRACKING_PARAMS = /^(utm_|ref|fbclid|gclid|gclsrc|mc_cid|mc_eid|spm|trk|ysclid|igshid|igsh$)/i;

// Canonical URL for dedupe + storage. News links are shared with tracking
// params and trailing slashes; normalize so the same story matches.
export function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  let out = url.toString();
  out = out.replace(/\/($|[?#])/, "$1");
  return out;
}