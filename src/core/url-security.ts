export type UrlSafetyCode =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "PRIVATE_NETWORK"
  | "CREDENTIALS_IN_URL"
  | "DANGEROUS_PORT"
  | "DANGEROUS_ACTION"
  | "OUTSIDE_ALLOWED_ORIGIN";

export type UrlSafetyResult =
  | { safe: true; code?: never; message?: never }
  | { safe: false; code: UrlSafetyCode; message: string };

const DANGEROUS_SEGMENTS = [
  "logout",
  "signout",
  "delete",
  "remove",
  "destroy",
  "unsubscribe",
  "checkout",
  "payment",
  "purchase",
  "admin/action",
  "api/delete"
];

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return false;
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function ipv4FromMappedIpv6(host: string): string | undefined {
  const match = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!match) return undefined;
  const high = Number.parseInt(match[1]!, 16);
  const low = Number.parseInt(match[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost")) {
    return true;
  }
  if (isPrivateIpv4(host)) return true;
  const mappedIpv4 = ipv4FromMappedIpv6(host);
  if (mappedIpv4 && isPrivateIpv4(mappedIpv4)) return true;
  const compact = host.replace(/^0+(?=[0-9a-f])/i, "");
  return (
    compact === "::1" || /^f[cd][0-9a-f]{2}:/i.test(compact) || /^fe[89ab][0-9a-f]:/i.test(compact)
  );
}

export function inspectUrlSafety(
  raw: string,
  options: { allowedOrigin?: string; excludeDangerousActions?: boolean } = {}
): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { safe: false, code: "INVALID_URL", message: "URL 无法解析。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, code: "UNSUPPORTED_PROTOCOL", message: "仅允许 HTTP 或 HTTPS。" };
  }
  if (url.username || url.password) {
    return { safe: false, code: "CREDENTIALS_IN_URL", message: "URL 中不得包含用户名或密码。" };
  }
  if (isPrivateHost(url.hostname)) {
    return { safe: false, code: "PRIVATE_NETWORK", message: "默认禁止访问本机或私网地址。" };
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    return { safe: false, code: "DANGEROUS_PORT", message: "该非标准端口不在安全访问范围内。" };
  }
  if (options.allowedOrigin && url.origin !== options.allowedOrigin) {
    return { safe: false, code: "OUTSIDE_ALLOWED_ORIGIN", message: "URL 不属于当前授权站点。" };
  }
  if (options.excludeDangerousActions !== false) {
    let path = url.pathname.toLowerCase();
    try {
      path = decodeURIComponent(url.pathname).toLowerCase();
    } catch {
      return { safe: false, code: "INVALID_URL", message: "URL 路径编码无效。" };
    }
    if (DANGEROUS_SEGMENTS.some((segment) => path.includes(segment))) {
      return {
        safe: false,
        code: "DANGEROUS_ACTION",
        message: "URL 可能触发登出或修改操作，已跳过。"
      };
    }
  }
  return { safe: true };
}
