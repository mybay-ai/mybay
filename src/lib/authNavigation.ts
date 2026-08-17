const expectedGuestUnauthorizedPaths = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/me",
]);

export function shouldBroadcastUnauthorized(path: string, status: number): boolean {
  const pathname = path.split("?")[0];
  return status === 401 && !expectedGuestUnauthorizedPaths.has(pathname);
}

export function isProtectedAppPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}
