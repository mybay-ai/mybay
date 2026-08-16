import { docker } from "./lib/docker";

/**
 * Docker Garbage Collector
 * Periodically cleans up dangling images and old custom build layers to save disk space.
 */
export async function startDockerGC(intervalMs: number = 1000 * 60 * 60 * 24) { // Default every 24 hours
  console.log(`[Docker GC] Background collector started (Interval: ${intervalMs / 3600000}h)`);
  
  const runGC = async () => {
    console.log("[Docker GC] Starting resource cleanup...");
    try {
      // 1. Prune dangling images (layers that are no longer part of any tagged image)
      const pruneResults = await docker.pruneImages({
        filters: { dangling: ["true"] }
      });
      if (pruneResults.ImagesDeleted) {
        console.log(`[Docker GC] Pruned ${pruneResults.ImagesDeleted.length} dangling images.`);
      }

      // 2. Optional: Clean up old custom images that haven't been used in a while
      // For now, simple dangling prune is safest and most effective.
      
      // 3. Clean up stopped containers that were left behind (like failed upgrades)
      await docker.pruneContainers({
        filters: { until: ["24h"] } // Only clean containers stopped for > 24h
      });

      console.log("[Docker GC] Resource cleanup finished.");
    } catch (err: any) {
      console.error("[Docker GC] Error during cleanup:", err.message);
    }
  };

  runGC(); // Run immediately on start
  setInterval(runGC, intervalMs);
}
