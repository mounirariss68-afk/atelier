import { useQueryClient } from "@tanstack/react-query";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { apiJson, HttpError } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/authEvents";
import { getTokenSync, loadToken, persistToken } from "@/lib/token";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel?: string;
  title?: string;
  initials?: string;
  avatarUrl?: string | null;
}

interface LoginResult {
  ok: boolean;
  // Task #821 — password step passed but a TOTP code is needed; the login
  // screen shows a code field and finishes via loginTwoFactor(challenge).
  twoFactorRequired?: boolean;
  challenge?: string;
  // Firm policy requires 2FA for this role but the user has not enrolled.
  twoFactorEnrollRequired?: boolean;
  errorKey?:
    | "login.invalid"
    | "login.rateLimited"
    | "login.failed"
    | "login.invalidCode"
    | "login.challengeExpired";
}

interface AuthCtx {
  ready: boolean;
  user: AuthUser | null;
  token: string | null;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginTwoFactor: (challenge: string, code: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string, totpCode?: string) => Promise<void>;
  clearForced: () => void;
}

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const doLocalClear = useCallback(async () => {
    await persistToken(null);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    qc.clear();
  }, [qc]);

  // Global 401 handler — any unauthorized response clears the session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void doLocalClear();
    });
    return () => setUnauthorizedHandler(null);
  }, [doLocalClear]);

  // Boot: restore a stored token and validate it via GET /auth/session.
  useEffect(() => {
    (async () => {
      const stored = await loadToken();
      if (stored) {
        try {
          const s = await apiJson<{
            user: AuthUser;
            mustChangePassword: boolean;
          }>("/api/auth/session");
          setToken(stored);
          setUser(s.user);
          setMustChangePassword(!!s.mustChangePassword);
        } catch {
          await persistToken(null);
        }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const r = await apiJson<{
          user: AuthUser;
          mustChangePassword: boolean;
          token: string;
          expiresAt: string;
          twoFactorRequired?: boolean;
          challenge?: string;
          twoFactorEnrollRequired?: boolean;
        }>("/api/auth/login", {
          method: "POST",
          auth: false,
          body: { email, password, client: "mobile" },
        });
        if (r.twoFactorRequired && r.challenge) {
          return { ok: false, twoFactorRequired: true, challenge: r.challenge };
        }
        await persistToken(r.token);
        setToken(r.token);
        setUser(r.user);
        setMustChangePassword(!!r.mustChangePassword);
        return { ok: true, twoFactorEnrollRequired: !!r.twoFactorEnrollRequired };
      } catch (e) {
        if (e instanceof HttpError) {
          if (e.status === 401) return { ok: false, errorKey: "login.invalid" };
          if (e.status === 429)
            return { ok: false, errorKey: "login.rateLimited" };
        }
        return { ok: false, errorKey: "login.failed" };
      }
    },
    [],
  );

  const loginTwoFactor = useCallback(
    async (challenge: string, code: string): Promise<LoginResult> => {
      try {
        const r = await apiJson<{
          user: AuthUser;
          mustChangePassword: boolean;
          token: string;
          expiresAt: string;
        }>("/api/auth/login/2fa", {
          method: "POST",
          auth: false,
          body: { challenge, code, client: "mobile" },
        });
        await persistToken(r.token);
        setToken(r.token);
        setUser(r.user);
        setMustChangePassword(!!r.mustChangePassword);
        return { ok: true };
      } catch (e) {
        if (e instanceof HttpError) {
          const err = (e.data as { error?: string } | null)?.error;
          if (err === "challenge-expired")
            return { ok: false, errorKey: "login.challengeExpired" };
          if (e.status === 401) return { ok: false, errorKey: "login.invalidCode" };
          if (e.status === 429) return { ok: false, errorKey: "login.rateLimited" };
        }
        return { ok: false, errorKey: "login.failed" };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      if (getTokenSync()) await apiJson("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort — clear locally regardless
    }
    await doLocalClear();
  }, [doLocalClear]);

  const changePassword = useCallback(
    // Task #821 — optional totpCode: sent when the server demanded step-up.
    async (current: string, next: string, totpCode?: string) => {
      await apiJson("/api/auth/change-password", {
        method: "POST",
        body: {
          currentPassword: current,
          newPassword: next,
          ...(totpCode?.trim() ? { totpCode: totpCode.trim() } : {}),
        },
      });
      setMustChangePassword(false);
    },
    [],
  );

  const clearForced = useCallback(() => setMustChangePassword(false), []);

  return (
    <Ctx.Provider
      value={{
        ready,
        user,
        token,
        mustChangePassword,
        login,
        loginTwoFactor,
        logout,
        changePassword,
        clearForced,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
