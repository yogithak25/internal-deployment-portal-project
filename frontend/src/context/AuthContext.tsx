import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { loadTokens, signOut as cognitoSignOut } from "../auth/cognito";

interface AuthContextValue {
  authenticated: boolean;
  setAuthenticated: (v: boolean) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(() => !!loadTokens());

  const logout = useCallback(() => {
    cognitoSignOut();
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ authenticated, setAuthenticated, logout }),
    [authenticated, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
