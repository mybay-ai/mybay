interface ActiveAction {
  action: string;
  timestamp: number;
}

// Global shared map for this session (singleton)
const recentActionsMap = new Map<string, ActiveAction>();

/**
 * Utility to register and check recently triggered operations (e.g., delete, archive, restore)
 * in the current page session. This is used to deduplicate/ignore incoming Socket broadcasts
 * for actions that were already performed and handled immediately locally on this page,
 * while still allowing other open tabs or sessions to automatically refresh via the socket.
 */
export const recentActions = {
  /**
   * Register a local action for a single instance ID.
   * @param instanceId The ID of the AgentInstance
   * @param action The action type (e.g., 'delete', 'archive', 'restore', 'redeploy')
   */
  register(instanceId: string, action: string) {
    const now = Date.now();
    recentActionsMap.set(`${instanceId}:${action}`, {
      action,
      timestamp: now
    });
    this.cleanup();
  },

  /**
   * Register a local action for multiple instance IDs (bulk operations).
   * @param instanceIds Array of AgentInstance IDs
   * @param action The action type
   */
  registerBulk(instanceIds: string[], action: string) {
    const now = Date.now();
    instanceIds.forEach(id => {
      recentActionsMap.set(`${id}:${action}`, { action, timestamp: now });
    });
    this.cleanup();
  },

  /**
   * Check if an action was recently performed locally on the current page for an instance.
   * We use a window of 2500ms as a safe, robust deduplication window.
   * Why 2500ms? It accounts for the API request journey, backend execution delay, and the full
   * round-trip propagation of the WebSocket message.
   * @param instanceId The ID of the AgentInstance
   * @param action Optional specific action type to check
   * @param thresholdMs The time window in milliseconds (default 2500ms)
   */
  isRecent(instanceId: string, action?: string, thresholdMs: number = 2500): boolean {
    if (!action) return false;
    const now = Date.now();

    const specific = recentActionsMap.get(`${instanceId}:${action}`);
    if (specific && (now - specific.timestamp) < thresholdMs) {
      return true;
    }

    return false;
  },

  /**
   * Lightweight cleanup strategy to prevent memory accumulation.
   * Cleans entries older than 10 seconds.
   */
  cleanup(expiryMs: number = 10000) {
    const now = Date.now();
    for (const [key, val] of recentActionsMap.entries()) {
      if (now - val.timestamp > expiryMs) {
        recentActionsMap.delete(key);
      }
    }
  },

  /**
   * Clear all stored actions.
   */
  clear() {
    recentActionsMap.clear();
  }
};
