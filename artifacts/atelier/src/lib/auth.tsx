import * as React from "react";

/**
 * Task #1 — real auth gate. Wraps the entire app: while the session check
 * is in flight we render a splash, when unauthenticated we render the
 * login screen, otherwise the app. A global `atelier:unauthenticated`
 * window event (dispatched when any API call returns 401) flips the gate
 * back to the login screen immediately.
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleLabel: string;
  title: string;
  initials: string;
  avatarUrl: string | null;
}

type AuthStatus = "loading" | "unauthenticated" | "authenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  // Task #5 — true when a partner reset this user's password; the app is
  // blocked behind a forced password change until it's cleared.
  mustChangePassword: boolean;
  // Task #59 — "joiner" (first-ever login on a temp password) vs "reset"
  // (partner reset); picks the copy on the forced-change screen.
  mustChangeReason: "joiner" | "reset" | null;
  clearMustChangePassword: () => void;
  setAuthenticated: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue>({
  status: "loading",
  user: null,
  mustChangePassword: false,
  mustChangeReason: null,
  clearMustChangePassword: () => {},
  setAuthenticated: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext);
}

export const UNAUTHENTICATED_EVENT = "atelier:unauthenticated";

export function notifyUnauthenticated(): void {
  window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = React.useState(false);
  const [mustChangeReason, setMustChangeReason] = React.useState<"joiner" | "reset" | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (r) => {
        if (!alive) return;
        if (r.ok) {
          const j = (await r.json()) as {
            user: AuthUser;
            mustChangePassword?: boolean;
            mustChangeReason?: "joiner" | "reset" | null;
          };
          setUser(j.user);
          setMustChangePassword(Boolean(j.mustChangePassword));
          setMustChangeReason(j.mustChangeReason ?? null);
          setStatus("authenticated");
        } else {
          setStatus("unauthenticated");
        }
      })
      .catch(() => {
        if (alive) setStatus("unauthenticated");
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    const onUnauthed = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthed);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthed);
  }, []);

  const setAuthenticated = React.useCallback((u: AuthUser) => {
    setUser(u);
    setStatus("authenticated");
  }, []);

  const clearMustChangePassword = React.useCallback(() => {
    setMustChangePassword(false);
    setMustChangeReason(null);
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
      setStatus("unauthenticated");
      // Hard reload clears all client caches (react-query, page state).
      window.location.replace("/");
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ status, user, mustChangePassword, mustChangeReason, clearMustChangePassword, setAuthenticated, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
