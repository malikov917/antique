import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import type { AuthErrorResponse, AuthUser, MeResponse, OtpRequestResponse, OtpVerifyResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const INITIAL_ACCESS_TOKEN = process.env.EXPO_PUBLIC_ACCESS_TOKEN ?? "";

interface ApiError {
  code?: string;
  message: string;
  status: number;
}

function asPlatform(): "ios" | "android" {
  return Platform.OS === "android" ? "android" : "ios";
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  let parsed: AuthErrorResponse | undefined;
  try {
    parsed = (await response.json()) as AuthErrorResponse;
  } catch {
    // noop
  }

  throw {
    code: parsed?.code,
    message: parsed?.error ?? `Request failed (${response.status})`,
    status: response.status
  } satisfies ApiError;
}

interface AuthSessionContextValue {
  accessToken: string;
  hasAccessToken: boolean;
  user: AuthUser | null;
  loadingUser: boolean;
  isAuthenticated: boolean;
  requestOtp: (phone: string) => Promise<OtpRequestResponse>;
  verifyOtp: (params: { phone: string; code: string }) => Promise<OtpVerifyResponse>;
  reloadUser: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  signOut: () => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState(INITIAL_ACCESS_TOKEN);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const deviceIdRef = useRef(`mobile-${asPlatform()}-${Date.now()}`);

  const reloadUser = useCallback(async () => {
    if (!accessToken.trim()) {
      setUser(null);
      return;
    }

    setLoadingUser(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const body = await readJson<MeResponse>(response);
      setUser(body.user);
    } catch {
      setUser(null);
      setAccessToken("");
    } finally {
      setLoadingUser(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void reloadUser();
  }, [reloadUser]);

  const requestOtp = useCallback(async (phone: string) => {
    const response = await fetch(`${API_BASE_URL}/v1/auth/otp/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    return readJson<OtpRequestResponse>(response);
  }, []);

  const verifyOtp = useCallback(async (params: { phone: string; code: string }) => {
    const response = await fetch(`${API_BASE_URL}/v1/auth/otp/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: params.phone,
        code: params.code,
        deviceId: deviceIdRef.current,
        platform: asPlatform()
      })
    });

    const body = await readJson<OtpVerifyResponse>(response);
    setAccessToken(body.tokens.accessToken);
    setUser(body.user);
    return body;
  }, []);

  const signOut = useCallback(() => {
    setAccessToken("");
    setUser(null);
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      accessToken,
      hasAccessToken: accessToken.trim().length > 0,
      user,
      loadingUser,
      isAuthenticated: accessToken.trim().length > 0 && user !== null,
      requestOtp,
      verifyOtp,
      reloadUser,
      setUser,
      signOut
    }),
    [accessToken, loadingUser, reloadUser, requestOtp, signOut, user, verifyOtp]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider");
  }
  return context;
}
