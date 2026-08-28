import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import type {
  PersistedRuntimeBindingSubject,
  RuntimeBinding,
  RuntimeDriver,
  RuntimeType,
} from "./contracts";

export class UnsupportedRuntimeTypeError extends Error {
  public readonly code = "UNSUPPORTED_RUNTIME_TYPE";

  public constructor(public readonly requestedRuntimeType: unknown) {
    super(`Unsupported runtime type: ${String(requestedRuntimeType)}`);
    this.name = "UnsupportedRuntimeTypeError";
  }
}

export class UnsupportedRuntimeBindingError extends Error {
  public readonly code = "UNSUPPORTED_RUNTIME_BINDING";

  public constructor(
    public readonly reason: "MISSING" | "INVALID" | "UNREGISTERED" | "INCONSISTENT",
    public readonly binding: unknown,
  ) {
    super(reason === "MISSING"
      ? "Runtime Binding is missing"
      : `Runtime Binding is ${reason.toLowerCase()}`);
    this.name = "UnsupportedRuntimeBindingError";
  }
}

export class RuntimeRegistry {
  private readonly drivers: ReadonlyMap<RuntimeType, RuntimeDriver>;
  private readonly driversByProviderKey: ReadonlyMap<string, RuntimeDriver>;

  public constructor(
    drivers: readonly RuntimeDriver[],
    public readonly defaultRuntimeType: RuntimeType,
  ) {
    for (const driver of drivers) {
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(driver.runtimeType)) {
        throw new Error(`Runtime Driver type is invalid: ${driver.runtimeType}`);
      }
      if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(driver.providerKey)) {
        throw new Error(`Runtime Driver provider key is invalid: ${driver.providerKey}`);
      }
      if (!Number.isSafeInteger(driver.contractVersion) || driver.contractVersion < 1) {
        throw new Error(`Runtime Driver contract version is invalid: ${driver.contractVersion}`);
      }
    }
    if (new Set(drivers.map((driver) => driver.runtimeType)).size !== drivers.length) {
      throw new Error("Runtime Driver is registered more than once");
    }
    this.drivers = new Map(drivers.map((driver) => [driver.runtimeType, driver]));
    if (new Set(drivers.map((driver) => driver.providerKey)).size !== drivers.length) {
      throw new Error("Runtime Driver provider key is registered more than once");
    }
    this.driversByProviderKey = new Map(drivers.map((driver) => [driver.providerKey, driver]));
    if (!this.drivers.has(defaultRuntimeType)) {
      throw new Error(`Default Runtime is not registered: ${defaultRuntimeType}`);
    }
  }

  public listRuntimeTypes(): RuntimeType[] {
    return [...this.drivers.keys()];
  }

  public listProviderKeys(): string[] {
    return [...this.driversByProviderKey.keys()];
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

  public createBindingForInstance(instance: { runtime_type?: unknown } | null | undefined): RuntimeBinding {
    const driver = this.get(this.resolveRuntimeType(instance?.runtime_type));
    return Object.freeze({
      runtimeType: driver.runtimeType,
      providerKey: driver.providerKey,
      contractVersion: driver.contractVersion,
    });
  }

  public resolveRunBinding(subject: PersistedRuntimeBindingSubject | null | undefined): RuntimeBinding {
    const rawRuntimeType = subject?.runtime_type;
    const rawProviderKey = subject?.runtime_provider_key;
    const rawContractVersion = subject?.runtime_contract_version;
    if (rawRuntimeType === undefined || rawRuntimeType === null || rawRuntimeType === ""
      || rawProviderKey === undefined || rawProviderKey === null || rawProviderKey === ""
      || rawContractVersion === undefined || rawContractVersion === null || rawContractVersion === "") {
      throw new UnsupportedRuntimeBindingError("MISSING", subject);
    }
    if (typeof rawRuntimeType !== "string" || typeof rawProviderKey !== "string") {
      throw new UnsupportedRuntimeBindingError("INVALID", subject);
    }
    const runtimeType = rawRuntimeType.trim().toLowerCase();
    const providerKey = rawProviderKey.trim().toLowerCase();
    const contractVersion = Number(rawContractVersion);
    if (!runtimeType || !providerKey || !Number.isSafeInteger(contractVersion) || contractVersion < 1) {
      throw new UnsupportedRuntimeBindingError("INVALID", subject);
    }
    const driver = this.driversByProviderKey.get(providerKey);
    if (!driver) throw new UnsupportedRuntimeBindingError("UNREGISTERED", subject);
    if (driver.runtimeType !== runtimeType || driver.contractVersion !== contractVersion) {
      throw new UnsupportedRuntimeBindingError("INCONSISTENT", subject);
    }
    return Object.freeze({ runtimeType: driver.runtimeType, providerKey: driver.providerKey, contractVersion });
  }

  public getForBinding(binding: RuntimeBinding): RuntimeDriver {
    const driver = this.driversByProviderKey.get(binding.providerKey);
    if (!driver) throw new UnsupportedRuntimeBindingError("UNREGISTERED", binding);
    if (driver.runtimeType !== binding.runtimeType || driver.contractVersion !== binding.contractVersion) {
      throw new UnsupportedRuntimeBindingError("INCONSISTENT", binding);
    }
    return driver;
  }
}

export const runtimeRegistry = new RuntimeRegistry([hermesRuntimeDriver], "hermes");
