import type { DeploymentStatus } from "../types";

const map: Record<string, string> = {
  pending: "badge-pending",
  running: "badge-running",
  success: "badge-success",
  failed: "badge-failed",
};

export function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = map[s] || "badge-pending";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export type { DeploymentStatus };
