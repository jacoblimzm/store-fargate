import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api/client";
import { clearRumUser, setRumUser } from "./observability/rum";
import type { User } from "./types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(api.getToken()));

  useEffect(() => {
    let active = true;
    if (!api.getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => {
        if (!active) return;
        setUser(u);
        setRumUser(u);
      })
      .catch(() => {
        api.clearToken();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = (token: string, u: User) => {
    api.setToken(token);
    setUser(u);
    setRumUser(u);
  };

  const signOut = () => {
    api.clearToken();
    setUser(null);
    clearRumUser();
  };

  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
