function isIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4(hostname)) return false;
  const [a, b] = hostname.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function isSafePublicHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const hostname = url.hostname.toLowerCase();
    if (!hostname) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "metadata.google.internal") return false;
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

export function assertSafePublicHttpUrl(raw: string): URL {
  if (!isSafePublicHttpUrl(raw)) {
    throw new Error("Invalid URL. Provide a public http(s) URL.");
  }
  return new URL(raw);
}
