export type DeploymentStatus = "pending" | "running" | "success" | "failed";

export interface Deployment {
  deployment_id: string;
  username?: string;
  environment: string;
  release_folder: string;
  target_instance_ids?: string[];
  script_path?: string;
  ssm_command_id?: string;
  status: DeploymentStatus | string;
  stdout?: string;
  stderr?: string;
  exit_code?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeployResponse {
  deployment_id: string;
  status: string;
  environment: string;
  release_folder: string;
  ssm_command_id: string;
}

export interface EnvironmentOption {
  id: string;
  label: string;
}
