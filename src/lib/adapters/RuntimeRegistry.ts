import { AgentRuntimeAdapter, AgentRuntimeType, RuntimeManifest } from "./types";
import { HermesRuntimeAdapter } from "./HermesRuntimeAdapter";
import { PiRuntimeAdapter } from "./PiRuntimeAdapter";

export class RuntimeRegistry {
  private static instance: RuntimeRegistry;
  private adapters: Map<AgentRuntimeType, AgentRuntimeAdapter> = new Map();

  private constructor() {
    // Register default built-in runtime adapters
    this.registerAdapter(new HermesRuntimeAdapter());
    this.registerAdapter(new PiRuntimeAdapter());
  }

  public static getInstance(): RuntimeRegistry {
    if (!RuntimeRegistry.instance) {
      RuntimeRegistry.instance = new RuntimeRegistry();
    }
    return RuntimeRegistry.instance;
  }

  public registerAdapter(adapter: AgentRuntimeAdapter): void {
    this.adapters.set(adapter.runtimeType, adapter);
  }

  public getAdapter(runtimeType: AgentRuntimeType = "hermes"): AgentRuntimeAdapter {
    const adapter = this.adapters.get(runtimeType);
    if (!adapter) {
      // Fallback to hermes adapter if requested type isn't registered
      const hermesAdapter = this.adapters.get("hermes");
      if (hermesAdapter) return hermesAdapter;
      throw new Error(`Runtime adapter for '${runtimeType}' is not registered`);
    }
    return adapter;
  }

  public listRegisteredRuntimes(): Array<{ type: AgentRuntimeType; manifest: RuntimeManifest }> {
    return Array.from(this.adapters.values()).map((adapter) => ({
      type: adapter.runtimeType,
      manifest: adapter.manifest,
    }));
  }
}

export const runtimeRegistry = RuntimeRegistry.getInstance();
