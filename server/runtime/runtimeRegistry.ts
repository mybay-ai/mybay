import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import type { RuntimeDriver, RuntimeType } from "./contracts";

export class UnsupportedRuntimeTypeError extends Error {
  public readonly code = "UNSUPPORTED_RUNTIME_TYPE";

  public constructor(public readonly requestedRuntimeType: unknown) {
    super(`Unsupported runtime type: ${String(requestedRuntimeType)}`);
    this.name = "UnsupportedRuntimeTypeError";
  }
}

export class RuntimeRegistry {
  private readonly drivers: ReadonlyMap<RuntimeType, RuntimeDriver>;

  public constructor(
    drivers: readonly RuntimeDriver[],
    public readonly defaultRuntimeType: RuntimeType,
  ) {
    for (const driver of drivers) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(driver.runtimeType)) {
        throw new Error(`Runtime Driver type is invalid: ${driver.runtimeType}`);
      }
    }
    if (new Set(drivers.map((driver) => driver.runtimeType)).size !== drivers.length) {
      throw new Error("Runtime Driver is registered more than once");
    }
    this.drivers = new Map(drivers.map((driver) => [driver.runtimeType, driver]));
    if (!this.drivers.has(defaultRuntimeType)) {
      throw new Error(`Default Runtime is not registered: ${defaultRuntimeType}`);
    }
  }

  public listRuntimeTypes(): RuntimeType[] {
    return [...this.drivers.keys()];
  }

  public resolveRuntimeType(value: unknown): RuntimeType {
    if (value === undefined || value === null || value === "") return this.defaultRuntimeType;
    if (typeof value !== "string") throw new UnsupportedRuntimeTypeError(value);
    const normalized = value.trim().toLowerCase();
    if (!this.drivers.has(normalized)) throw new UnsupportedRuntimeTypeError(value);
    return normalized;
  }

  public get(runtimeType: RuntimeType = this.defaultRuntimeType): RuntimeDriver {
    const driver = this.drivers.get(runtimeType);
    if (!driver) throw new UnsupportedRuntimeTypeError(runtimeType);
    return driver;
  }
}

export const runtimeRegistry = new RuntimeRegistry([hermesRuntimeDriver], "hermes");
