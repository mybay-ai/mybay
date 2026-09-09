import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import { piRuntimeDriver } from "./adapters/pi/PiRuntimeDriver";
import { defineRuntimeDriverContract } from "./testing/runtimeDriverContract";
import { HERMES_RUNTIME_DEFINITION, PI_RUNTIME_DEFINITION, CODEX_RUNTIME_DEFINITION } from "../../shared/runtimeCatalog";

defineRuntimeDriverContract(hermesRuntimeDriver, {
  runtimeType: HERMES_RUNTIME_DEFINITION.runtime.type,
  displayName: HERMES_RUNTIME_DEFINITION.displayName,
  providerKey: HERMES_RUNTIME_DEFINITION.providerKey,
  contractVersion: HERMES_RUNTIME_DEFINITION.contractVersion,
});

defineRuntimeDriverContract(piRuntimeDriver, {
  runtimeType: PI_RUNTIME_DEFINITION.runtime.type,
  displayName: PI_RUNTIME_DEFINITION.displayName,
  providerKey: PI_RUNTIME_DEFINITION.providerKey,
  contractVersion: PI_RUNTIME_DEFINITION.contractVersion,
});

import { codexRuntimeDriver } from "./adapters/codex/CodexRuntimeDriver";
defineRuntimeDriverContract(codexRuntimeDriver, { runtimeType: "codex", displayName: CODEX_RUNTIME_DEFINITION.displayName, providerKey: CODEX_RUNTIME_DEFINITION.providerKey, contractVersion: 1 });
