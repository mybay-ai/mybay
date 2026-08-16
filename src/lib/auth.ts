import { User } from "../types";

const AUTH_KEY = "mybay_user";
const TOKEN_KEY = "mybay_token";

export function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (!saved) return null;
    
    const user = JSON.parse(saved);
    // Remove legacy Web JWT material during the cookie-only migration.
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TOKEN_KEY);
    
    return user;
  } catch (err) {
    console.error("Failed to parse stored user", err);
    return null;
  }
}

export function setStoredUser(user: User): void {
  if (typeof window === "undefined") return;
  const { token: _legacyToken, ...rest } = user;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(TOKEN_KEY);
  
  localStorage.setItem(AUTH_KEY, JSON.stringify(rest));
}

export function clearStoredUser(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_KEY);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return null;
}
