import { Navigate, useLocation } from "react-router-dom";
import { loadTokens } from "../auth/cognito";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (!loadTokens()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}
