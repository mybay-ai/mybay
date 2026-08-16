import { dbAdapter } from "../db";

export interface DeploymentEvent {
  id?: string;
  instance_id: string;
  owner_id?: string | null;
  step: string;
  status: string;
  message?: string;
  metadata?: any;
  created_at?: string;
}

export const deploymentEventsRepo = {
  create(event: DeploymentEvent) { return dbAdapter.createDeploymentEvent(event); },
  listByInstance(instanceId: string) { return dbAdapter.listDeploymentEventsByInstance(instanceId); }
};
