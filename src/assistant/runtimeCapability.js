function normalizedHostname(locationLike) {
  return String(locationLike?.hostname ?? "").trim().toLowerCase().replace(/\.$/u, "");
}

export function isGitHubPagesLocation(locationLike) {
  const hostname = normalizedHostname(locationLike);
  return hostname === "github.io" || hostname.endsWith(".github.io");
}

export function assistantRuntimeCapability(locationLike) {
  if (isGitHubPagesLocation(locationLike)) {
    return Object.freeze({
      available: false,
      code: "static-github-pages",
      message: "The page assistant is unavailable on GitHub Pages because it requires RoboStudio's local server proxy. Browser-only workspace tools remain available, and no API key is exposed."
    });
  }
  return Object.freeze({ available: true, code: "server-capable", message: "" });
}
