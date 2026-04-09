import {
  CognitoUser,
  CognitoUserPool,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

const poolId = import.meta.env.VITE_USER_POOL_ID;
const clientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;

let userPool: CognitoUserPool | null = null;

function getPool(): CognitoUserPool {
  if (!poolId || !clientId) {
    throw new Error("Cognito is not configured (VITE_USER_POOL_ID / VITE_USER_POOL_CLIENT_ID)");
  }
  if (!userPool) {
    userPool = new CognitoUserPool({
      UserPoolId: poolId,
      ClientId: clientId,
    });
  }
  return userPool;
}

const STORAGE_KEY = "deployment_portal_tokens";
const USER_KEY = "deployment_portal_user";

export interface StoredTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
}

export function saveTokens(t: StoredTokens, username?: string): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  if (username) sessionStorage.setItem(USER_KEY, username);
}

export function loadTokens(): StoredTokens | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function getStoredUsername(): string | null {
  return sessionStorage.getItem(USER_KEY);
}

export function clearTokens(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function getIdToken(): string | null {
  return loadTokens()?.idToken ?? null;
}

export function signIn(username: string, password: string): Promise<StoredTokens> {
  return new Promise((resolve, reject) => {
    const authDetails = new AuthenticationDetails({
      Username: username.trim(),
      Password: password,
    });
    const cognitoUser = new CognitoUser({
      Username: username.trim(),
      Pool: getPool(),
    });
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const idToken = session.getIdToken().getJwtToken();
        const accessToken = session.getAccessToken().getJwtToken();
        const refreshToken = session.getRefreshToken().getToken();
        const tokens = { idToken, accessToken, refreshToken };
        saveTokens(tokens, username.trim());
        resolve(tokens);
      },
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  const name = getStoredUsername();
  clearTokens();
  if (!poolId || !clientId || !name) return;
  const cognitoUser = new CognitoUser({ Username: name, Pool: getPool() });
  cognitoUser.signOut(() => {});
}
