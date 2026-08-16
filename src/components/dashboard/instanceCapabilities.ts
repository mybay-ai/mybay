import { AgentInstance } from "../../types";

export interface InstanceCapabilities {
  canStart: boolean;
  canRestart: boolean;
  canStop: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canRestoreFromArchive: boolean;
  isArchived: boolean;
  isTransitioning: boolean;
  isFailed: boolean;
  isRunning: boolean;
  isStopped: boolean;
}

export function getInstanceCapabilities(instance: AgentInstance): InstanceCapabilities {
  const status = (instance.status || '').toLowerCase();
  const physicalStatus = (instance.physical_status || '').toLowerCase();
  const isArchived = instance.archived === true;
  
  const isStopped = status === 'stopped';
  const isFailed = status === 'failed';
  const isTransitioning = [
    'deploying', 
    'restarting', 
    'starting', 
    'container_starting', 
    'creating', 
    'initializing', 
    'gateway_starting',
    'gateway_syncing'
  ].includes(status);

  // Keep action availability aligned with the status badge: a container can be
  // physically running while the logical status describes a degraded subsystem.
  const hasRunningContainer = physicalStatus === 'running' || [
    'running',
    'partial_running',
    'gateway_ready',
    'dashboard_ready',
    'unhealthy',
    'frontend_missing_build'
  ].includes(status);
  const isRunning = hasRunningContainer && !isArchived;

  return {
    canStart: (isStopped || (isFailed && !hasRunningContainer)) && !isArchived,
    canRestart: isRunning && !isTransitioning,
    canStop: (isRunning || isTransitioning) && !isArchived,
    canArchive: !isArchived,
    canDelete: true,
    canRestoreFromArchive: isArchived,
    
    isArchived,
    isTransitioning,
    isFailed,
    isRunning,
    isStopped
  };
}
