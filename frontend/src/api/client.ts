import { getIdToken } from "../auth/cognito";
import type { DeployResponse, Deployment, EnvironmentOption } from "../types";

const base = import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "";

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getIdToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error: string }).error)
        : res.statusText;
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return data as T;
}

export async function getHealth(): Promise<{ status: string }> {
  return request("/health");
}

export async function getEnvironments(): Promise<{ environments: EnvironmentOption[] }> {
  return request("/environments");
}

export async function postDeploy(body: {
  environment: string;
  release_folder: string;
}): Promise<DeployResponse> {
  return request("/deploy", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listDeployments(): Promise<{ deployments: Deployment[] }> {
  return request("/deployments");
}

export async function getDeployment(id: string): Promise<Deployment> {
  return request(`/deployments/${encodeURIComponent(id)}`);
}
