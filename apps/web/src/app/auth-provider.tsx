"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { usePathname,useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const TOKEN_KEY = "nova-aurora.session";
const IDENTITY_KEY = "nova-aurora.identity";

type Identity = Readonly<{
  userId: string;
  email: string;
  displayName: string;
  sessionId: string;
  roles: readonly string[];
  expiresAt: string;
}>;

type AuthContextValue = Readonly<{
  identity: Identity | null;
  token: string | null;
  setSession(token: string, identity: Identity): void;
  logout(): Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

function storedIdentity(): Identity | null {
  try {
    const value = localStorage.getItem(IDENTITY_KEY);
    return value ? JSON.parse(value) as Identity : null;
  } catch {
    return null;
  }
}

function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(IDENTITY_KEY);
}

function isProtectedPath(pathname: string): boolean {
  return [
    "/game",
    "/business",
    "/marketplace",
    "/management",
    "/governance",
    "/municipality",
    "/dashboard",
    "/account",
    "/integrity",
    "/release",
    "/operations",
    "/moderation",
    "/beta-control",
    "/appeal",
    "/community",
    "/feedback",
    "/beta-insights",
    "/guardian-request"
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPublicAuthRequest(requestUrl: string): boolean {
  return requestUrl.includes("/v1/auth/login")
    || requestUrl.includes("/v1/auth/register")
    || requestUrl.includes("/v1/auth/mfa/complete")
    || requestUrl.includes("/v1/auth/recovery/")
    || requestUrl.includes("/v1/auth/email-verification/confirm")
    || requestUrl.includes("/v1/trust/public")
    || requestUrl.includes("/v1/trust/reports")
    || requestUrl.includes("/v1/trust/guardian/decision")
    || requestUrl.includes("/v1/status/public");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready,setReady] = useState(false);
  const [token,setToken] = useState<string | null>(null);
  const [identity,setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const initialToken = localStorage.getItem(TOKEN_KEY);
    const initialIdentity = storedIdentity();
    setToken(initialToken);
    setIdentity(initialIdentity);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : input;
      const isApi = requestUrl.startsWith(API_URL);
      if (!isApi) return originalFetch(input,init);

      const activeToken = localStorage.getItem(TOKEN_KEY);
      const activeIdentity = storedIdentity();
      const publicAuth = isPublicAuthRequest(requestUrl);
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value,name) => headers.set(name,value));

      const legacyActor = headers.get("x-actor-email");
      headers.delete("x-actor-email");
      if (activeToken && !publicAuth) {
        headers.set("authorization",`Bearer ${activeToken}`);
      }
      if (legacyActor
        && activeIdentity
        && legacyActor.toLowerCase() !== activeIdentity.email.toLowerCase()
        && activeIdentity.roles.includes("platform-admin")) {
        headers.set("x-actor-context",legacyActor);
      }

      const response = await originalFetch(input,{ ...init,headers });
      if (response.status === 401 && !publicAuth) {
        clearSession();
        setToken(null);
        setIdentity(null);
        if (window.location.pathname !== "/login") {
          window.location.assign(
            `/login?returnTo=${encodeURIComponent(window.location.pathname)}`
          );
        }
      }
      return response;
    };

    setReady(true);
    return () => { window.fetch = originalFetch; };
  },[]);

  useEffect(() => {
    if (!ready || !isProtectedPath(pathname)) return;
    if (!token) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    void fetch(`${API_URL}/v1/auth/me`,{ cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const nextIdentity = await response.json() as Identity;
        localStorage.setItem(IDENTITY_KEY,JSON.stringify(nextIdentity));
        setIdentity(nextIdentity);
      })
      .catch(() => undefined);
  },[pathname,ready,router,token]);

  const setSession = useCallback((nextToken: string,nextIdentity: Identity) => {
    localStorage.setItem(TOKEN_KEY,nextToken);
    localStorage.setItem(IDENTITY_KEY,JSON.stringify(nextIdentity));
    setToken(nextToken);
    setIdentity(nextIdentity);
  },[]);

  const logout = useCallback(async () => {
    try {
      if (localStorage.getItem(TOKEN_KEY)) {
        await fetch(`${API_URL}/v1/auth/logout`,{ method: "POST" });
      }
    } finally {
      clearSession();
      setToken(null);
      setIdentity(null);
      router.replace("/login");
    }
  },[router]);

  const value = useMemo<AuthContextValue>(() => ({
    identity,token,setSession,logout
  }),[identity,logout,setSession,token]);

  if (!ready) return <div aria-live="polite">Inicializando identidade segura…</div>;
  if (isProtectedPath(pathname) && !token) {
    return <div aria-live="polite">Redirecionando para autenticação…</div>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider não configurado.");
  return value;
}
