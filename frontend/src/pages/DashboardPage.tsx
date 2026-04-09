import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getDeployment,
  getEnvironments,
  listDeployments,
  postDeploy,
} from "../api/client";
import { getStoredUsername } from "../auth/cognito";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import type { Deployment, EnvironmentOption } from "../types";

const RELEASE_REGEX = /^[a-zA-Z0-9_-]+$/;

function usePollDeployment(
  id: string | null,
  onUpdate: (d: Deployment) => void,
  active: boolean
) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!id || !active) return;
    const tick = async () => {
      try {
        const d = await getDeployment(id);
        onUpdate(d);
        const t = d.status?.toLowerCase();
        if (t === "success" || t === "failed") {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
        }
      } catch {
        /* ignore transient errors */
      }
    };
    tick();
    timer.current = setInterval(tick, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [id, active, onUpdate]);
}

export function DashboardPage() {
  const { logout } = useAuth();
  const [envs, setEnvs] = useState<EnvironmentOption[]>([]);
  const [environment, setEnvironment] = useState("");
  const [releaseFolder, setReleaseFolder] = useState("");
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deploySubmitting, setDeploySubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Deployment | null>(null);

  const [activePollId, setActivePollId] = useState<string | null>(null);
  const [lastDeploy, setLastDeploy] = useState<Deployment | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const { deployments: list } = await listDeployments();
      setDeployments(list);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load deployments");
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { environments } = await getEnvironments();
        setEnvs(environments);
        setEnvironment((prev) => prev || environments[0]?.id || "");
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load environments");
      }
    })();
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (deploySubmitting) return;
      if (detail) setDetail(null);
      else if (confirmOpen) setConfirmOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, detail, deploySubmitting]);

  const onDetailUpdate = useCallback(
    (d: Deployment) => {
      setLastDeploy((prev) => (prev?.deployment_id === d.deployment_id ? d : prev));
      setDeployments((rows) =>
        rows.map((r) => (r.deployment_id === d.deployment_id ? { ...r, ...d } : r))
      );
      setDetail((prev) => (prev?.deployment_id === d.deployment_id ? { ...prev, ...d } : prev));
    },
    []
  );

  usePollDeployment(activePollId, onDetailUpdate, !!activePollId);

  function validateForm(): string | null {
    if (!environment) return "Select an environment";
    if (!releaseFolder.trim()) return "Enter a release folder";
    if (!RELEASE_REGEX.test(releaseFolder.trim())) {
      return "Release folder: letters, numbers, underscore, and hyphen only";
    }
    return null;
  }

  function openConfirm(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setConfirmError(null);
    const v = validateForm();
    if (v) {
      setSubmitError(v);
      return;
    }
    setConfirmOpen(true);
  }

  async function runDeploy() {
    setConfirmError(null);
    setDeploySubmitting(true);
    try {
      const res = await postDeploy({
        environment,
        release_folder: releaseFolder.trim(),
      });
      setConfirmOpen(false);
      setReleaseFolder("");
      setActivePollId(res.deployment_id);
      setLastDeploy({
        deployment_id: res.deployment_id,
        status: res.status,
        environment: res.environment,
        release_folder: res.release_folder,
        ssm_command_id: res.ssm_command_id,
      });
      await refreshList();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Deployment failed. Try again or contact ops.");
    } finally {
      setDeploySubmitting(false);
    }
  }

  async function openDetails(row: Deployment) {
    try {
      const d = await getDeployment(row.deployment_id);
      setDetail(d);
    } catch (e) {
      setDetail(row);
    }
  }

  const displayUser = getStoredUsername() || "User";

  const scriptPath =
    environment === "PROD"
      ? "/opt/deploy/scripts/prod_deployment.sh"
      : "/opt/deploy/scripts/uat_deployment.sh";

  const releaseArg = releaseFolder.trim() || "<release_folder>";

  const executionLogText = useMemo(() => {
    if (!lastDeploy) {
      return [
        "# SSM execution log",
        "# No deployment yet — configure release on the left, then submit.",
        "# Logs update automatically while a run is in progress.",
      ].join("\n");
    }
    const lines: string[] = [
      `[${lastDeploy.updated_at || lastDeploy.created_at || "—"}] status=${lastDeploy.status}`,
      `[DEPLOY] id=${lastDeploy.deployment_id}`,
      `[ENV] ${lastDeploy.environment}  [RELEASE] ${lastDeploy.release_folder}`,
    ];
    if (lastDeploy.ssm_command_id) {
      lines.push(`[SSM] CommandId: ${lastDeploy.ssm_command_id}`);
    }
    if (lastDeploy.target_instance_ids?.length) {
      lines.push(`[TARGETS] ${lastDeploy.target_instance_ids.join(", ")}`);
    }
    if (lastDeploy.stdout?.trim()) {
      lines.push("--- stdout ---");
      lines.push(lastDeploy.stdout.trim());
    }
    if (lastDeploy.stderr?.trim()) {
      lines.push("--- stderr ---");
      lines.push(lastDeploy.stderr.trim());
    }
    if (lastDeploy.exit_code != null && lastDeploy.exit_code !== undefined) {
      lines.push(`[EXIT] ${String(lastDeploy.exit_code)}`);
    }
    return lines.join("\n");
  }, [lastDeploy]);

  const statusKey = lastDeploy?.status?.toLowerCase() ?? "";

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-brand">
          <h1>Deployment Portal</h1>
          <p className="app-header-tagline">Run releases on UAT or PROD via Systems Manager</p>
        </div>
        <div className="app-header-actions">
          <span className="user-pill" title="Signed-in user">
            {displayUser}
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="app-main">
        {loadError && <div className="alert alert-error">{loadError}</div>}

        <div className="dashboard-columns">
          <section className="dark-card" aria-labelledby="deploy-heading">
            <h2 id="deploy-heading" className="dark-card-header">
              🚀 Release configuration
            </h2>
            <p className="dark-card-lead">
              Select the target environment and release identifier. The command below is what Systems
              Manager will run on your tagged EC2 instances after you confirm.
            </p>
            <form onSubmit={openConfirm}>
              <div className="deploy-form-grid">
                <div className="form-row">
                  <label htmlFor="env">Environment</label>
                  <select
                    id="env"
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value)}
                    aria-describedby="env-hint"
                  >
                    {envs.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <p id="env-hint" className="field-hint">
                    Targets running instances with tag <code>Environment</code> = UAT or PROD.
                  </p>
                </div>
                <div className="form-row">
                  <label htmlFor="rel">Release folder</label>
                  <input
                    id="rel"
                    type="text"
                    placeholder="e.g. uat_20260323"
                    value={releaseFolder}
                    onChange={(e) => setReleaseFolder(e.target.value)}
                    autoComplete="off"
                    aria-describedby="rel-hint"
                  />
                  <p id="rel-hint" className="field-hint">
                    Letters, numbers, hyphen, and underscore only. Passed as the script argument.
                  </p>
                </div>
              </div>

              <div className="code-preview">
                <p className="code-preview-title">Resolved SSM command (preview)</p>
                <pre className="code-preview-body">
                  <span className="hl-command">{scriptPath}</span>{" "}
                  <span className="hl-arg">{releaseArg}</span>
                </pre>
              </div>

              {submitError && <div className="alert alert-error">{submitError}</div>}
              <div className="deploy-actions">
                <p className="deploy-actions-caption">
                  Nothing runs until you confirm in the next step.
                </p>
                <button
                  type="submit"
                  className="btn btn-gradient btn-lg btn-block"
                  disabled={deploySubmitting}
                >
                  <span className="btn-submit-icon" aria-hidden>
                    ⚡
                  </span>
                  Review &amp; submit deployment
                </button>
              </div>
            </form>
          </section>

          <section className="dark-card" aria-labelledby="cloud-heading">
            <h2 id="cloud-heading" className="dark-card-header">
              ☁️ Cloud deployment
            </h2>
            <p className="dark-card-lead">
              One-click style flow: after you confirm, the portal triggers AWS Systems Manager Run
              Command on all matching instances — no SSH. Status and logs stream here from your last
              deployment.
            </p>

            {!lastDeploy && (
              <div className="status-banner status-banner--idle" role="status">
                <span aria-hidden>○</span> Ready — submit a deployment to see live status.
              </div>
            )}
            {lastDeploy && statusKey === "success" && (
              <div className="status-banner status-banner--success" role="status">
                <span aria-hidden>🚀</span>
                Deployment successful — SSM Run Command completed on your targets.
              </div>
            )}
            {lastDeploy && (statusKey === "running" || statusKey === "pending") && (
              <div className="status-banner status-banner--running" role="status">
                <span aria-hidden>⏳</span>
                In progress — polling SSM for stdout/stderr…
              </div>
            )}
            {lastDeploy && statusKey === "failed" && (
              <div className="status-banner status-banner--failed" role="status">
                <span aria-hidden>✕</span>
                Deployment failed — check stderr in the log below or open Details in history.
              </div>
            )}

            <div className="execution-log-wrap">
              <p className="execution-log-title">SSM execution log</p>
              <pre className="execution-log" role="log" aria-live="polite">
                {executionLogText}
              </pre>
            </div>
          </section>
        </div>

        <section className="dark-card history-card">
          <div className="toolbar">
            <h2 className="dark-card-header" style={{ flex: 1, margin: 0 }}>
              📜 Deployment history
            </h2>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refreshList()}
              title="Reload deployment list from the API"
            >
              Refresh list
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Environment</th>
                  <th>Release</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.deployment_id}>
                    <td>
                      <code>{d.deployment_id}</code>
                    </td>
                    <td>{d.environment}</td>
                    <td>
                      <code>{d.release_folder}</code>
                    </td>
                    <td>{d.username ?? "—"}</td>
                    <td>
                      <StatusBadge status={String(d.status)} />
                    </td>
                    <td>{d.created_at ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: "0.25rem 0.5rem", fontSize: "0.8125rem" }}
                        onClick={() => openDetails(d)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {deployments.length === 0 && (
              <p className="dark-card-lead" style={{ marginBottom: 0 }}>
                No deployments yet.
              </p>
            )}
          </div>
        </section>
      </main>

      {confirmOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !deploySubmitting && setConfirmOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-deploy-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 id="confirm-deploy-title">Start this deployment?</h3>
            </div>
            <div className="modal-body">
              <div className="summary-box">
                <dl>
                  <div>
                    <dt>Environment</dt>
                    <dd>{environment}</dd>
                  </div>
                  <div>
                    <dt>Release folder</dt>
                    <dd>
                      <code>{releaseFolder.trim()}</code>
                    </dd>
                  </div>
                </dl>
              </div>
              <p className="confirm-text" style={{ marginBottom: 0 }}>
                The portal will run your organization&apos;s deployment script on <strong>all running</strong>{" "}
                EC2 instances with the matching <code>Environment</code> tag, using{" "}
                <strong>AWS Systems Manager</strong> (not SSH).
              </p>
              {confirmError && (
                <div className="alert alert-error" style={{ marginTop: "1rem", marginBottom: 0 }}>
                  {confirmError}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={() => setConfirmOpen(false)}
                disabled={deploySubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-gradient btn-lg"
                onClick={() => void runDeploy()}
                disabled={deploySubmitting}
              >
                {deploySubmitting ? (
                  <>
                    <span className="btn-spinner" aria-hidden />
                    Starting…
                  </>
                ) : (
                  <>
                    <span className="btn-submit-icon" aria-hidden>
                      ☁️
                    </span>
                    Deploy to cloud
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
          <div
            className="modal"
            style={{ maxWidth: 720 }}
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Deployment {detail.deployment_id}</h3>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <p>
                <StatusBadge status={String(detail.status)} /> · {detail.environment} ·{" "}
                <code>{detail.release_folder}</code>
              </p>
              <p style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                User: {detail.username ?? "—"} · Created: {detail.created_at ?? "—"} · Updated:{" "}
                {detail.updated_at ?? "—"}
              </p>
              {detail.ssm_command_id && (
                <p style={{ fontSize: "0.8125rem" }}>
                  SSM command: <code>{detail.ssm_command_id}</code>
                </p>
              )}
              {detail.target_instance_ids && detail.target_instance_ids.length > 0 && (
                <p style={{ fontSize: "0.8125rem" }}>
                  Targets: {detail.target_instance_ids.join(", ")}
                </p>
              )}
              {detail.script_path && (
                <p style={{ fontSize: "0.8125rem" }}>
                  Script: <code>{detail.script_path}</code>
                </p>
              )}
              {detail.exit_code != null && detail.exit_code !== undefined && (
                <p style={{ fontSize: "0.8125rem" }}>Exit code: {String(detail.exit_code)}</p>
              )}
              <div>
                <strong>Stdout</strong>
                <div className="log-block">{detail.stdout || "(empty)"}</div>
              </div>
              <div style={{ marginTop: "0.75rem" }}>
                <strong>Stderr</strong>
                <div className="log-block">{detail.stderr || "(empty)"}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
