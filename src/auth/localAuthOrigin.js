import { authConfig } from "./authConfig.js";

const LOCALHOST_NAMES = new Set(["localhost", "::1", "[::1]"]);

export function getCanonicalLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    if (
      !authConfig.localDev.enforceSingleOrigin
      || url.protocol !== "http:"
      || !LOCALHOST_NAMES.has(url.hostname)
    ) {
      return origin;
    }
    url.hostname = authConfig.localDev.canonicalHost;
    return url.origin;
  } catch {
    return origin;
  }
}

export function getCanonicalLocalUrl(href) {
  try {
    const url = new URL(href);
    const canonicalOrigin = getCanonicalLocalOrigin(url.origin);
    if (canonicalOrigin === url.origin) return null;
    return new URL(`${url.pathname}${url.search}${url.hash}`, canonicalOrigin).toString();
  } catch {
    return null;
  }
}
