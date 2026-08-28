import type { RuntimeType } from "./RuntimeDriver";

/** Immutable Runtime identity captured when MyBay creates a durable Run. */
export interface RuntimeBinding {
  readonly runtimeType: RuntimeType;
  readonly providerKey: string;
  readonly contractVersion: number;
}

/** Database-shaped subject used to recover a persisted Runtime Binding. */
export interface PersistedRuntimeBindingSubject {
  readonly runtime_type?: unknown;
  readonly runtime_provider_key?: unknown;
  readonly runtime_contract_version?: unknown;
}
