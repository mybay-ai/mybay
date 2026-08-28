import { hermesRuntimeDriver } from "./adapters/hermes/HermesRuntimeDriver";
import { piRuntimeDriver } from "./adapters/pi/PiRuntimeDriver";
import { defineRuntimeDriverContract } from "./testing/runtimeDriverContract";

defineRuntimeDriverContract(hermesRuntimeDriver, {
  runtimeType: "hermes",
  displayName: "Hermes",
  providerKey: "hermes-core",
  contractVersion: 1,
});

defineRuntimeDriverContract(piRuntimeDriver, {
  runtimeType: "pi",
  displayName: "Pi",
  providerKey: "pi-preview",
  contractVersion: 1,
});
