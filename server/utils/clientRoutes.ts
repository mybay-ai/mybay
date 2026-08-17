const exactClientRoutes = new Set([
  "/",
  "/changelog",
  "/contact",
  "/demo",
  "/docs",
  "/faq",
  "/features",
  "/instance-login",
  "/login",
  "/models",
  "/privacy",
  "/register",
  "/security",
  "/terms",
]);

const clientRoutePrefixes = ["/app/", "/auth/", "/demo/", "/docs/", "/landing/"];

export function isKnownClientRoute(urlPath: string): boolean {
  const pathname = urlPath.split("?")[0];
  if (exactClientRoutes.has(pathname) || pathname === "/app") return true;
  return clientRoutePrefixes.some((prefix) => pathname.startsWith(prefix));
}