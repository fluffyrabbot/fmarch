export function isExternallyHostedUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return false;
  }
  const ipv4Address = parseIpv4Address(hostname);
  if (ipv4Address !== null) {
    return isPublicIpv4Address(ipv4Address);
  }
  if (hostname.includes(":") || hostname.startsWith("[") || hostname.endsWith("]")) {
    return isPublicIpv6Address(hostname.replace(/^\[/, "").replace(/\]$/, ""));
  }
  return hostname !== "";
}

function parseIpv4Address(hostname) {
  const octets = hostname.split(".");
  if (octets.length !== 4) {
    return null;
  }
  const parsed = octets.map((octet) => {
    if (!/^\d{1,3}$/.test(octet)) {
      return null;
    }
    const value = Number(octet);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });
  return parsed.every((octet) => octet !== null) ? parsed : null;
}

function isPublicIpv4Address([first, second, third]) {
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPublicIpv6Address(hostname) {
  if (hostname === "" || hostname === "::" || hostname === "::1") {
    return false;
  }
  const normalized = hostname.toLowerCase();
  return !(
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}
