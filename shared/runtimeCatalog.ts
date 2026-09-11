import { CODEX_BUILD } from "./codexBuild";
export type RuntimeType = string;

export type RuntimeSupportStatus = "available" | "spec-only";
export type RuntimeCertificationLevel = "spec-only" | "experimental" | "beta" | "certified";
export type RuntimeArtifactIdentityKind = "oci-digest" | "docker-image-id";

export interface RuntimeArtifactIdentity {
  readonly kind: RuntimeArtifactIdentityKind;
  readonly value: string;
}

export interface RuntimeLifecycleCapabilities {
  readonly conversation: {
    readonly modes: ReadonlyArray<"streaming" | "batch">;
  };
  readonly cancellation: {
    readonly supported: boolean;
    readonly granularity?: "run" | "turn";
  };
  readonly terminal: {
    readonly observation: "status" | "events" | "unsupported";
  };
  readonly interactions: {
    readonly approvals: boolean;
    readonly questions: boolean;
  };
}

export interface RuntimeProductCapabilities {
  readonly chat: boolean;
  readonly fileUpload: boolean;
  readonly scheduledTasks: boolean;
  readonly browser: boolean;
  readonly shell: boolean;
  readonly imChannels: readonly string[];
}

export interface RuntimeDefinition {
  readonly specVersion: "1.0.0";
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly description: string;
  readonly providerKey: string;
  readonly contractVersion: number;
  readonly release: {
    readonly supportStatus: RuntimeSupportStatus;
    readonly certificationLevel: RuntimeCertificationLevel;
    readonly deploymentSupported: boolean;
    /** MyBay-owned bridge revision, or null when no bridge exists. */
    readonly bridgeVersion: string | null;
    /** Immutable build admitted by the current release, or null while identity is pending. */
    readonly artifactIdentity: RuntimeArtifactIdentity | null;
  };
  readonly runtime: {
    readonly type: RuntimeType;
    readonly image: string;
    readonly tag: string;
    readonly internalPort: number;
    readonly environmentVariables: ReadonlyArray<{
      readonly name: string;
      readonly description: string;
      readonly required: boolean;
      readonly sensitive: boolean;
    }>;
  };
  readonly health: {
    readonly endpoint: string;
    readonly intervalSeconds: number;
    readonly timeoutSeconds: number;
    readonly expectedStatusCode: number;
  };
  readonly storage: {
    readonly dataPath: string;
    readonly configPath: string;
    readonly volumeNamePrefix: string;
  };
  readonly capabilities: RuntimeProductCapabilities;
  readonly lifecycle: RuntimeLifecycleCapabilities;
  readonly resources: {
    readonly minimumMemory: string;
    readonly recommendedMemory: string;
    readonly minimumCpu: number;
  };
  readonly backup: {
    readonly includePaths: readonly string[];
    readonly excludePatterns: readonly string[];
  };
}

export type RuntimeManifest = Omit<RuntimeDefinition, "providerKey" | "contractVersion">;

function freezeRuntimeDefinition(definition: RuntimeDefinition): RuntimeDefinition {
  return Object.freeze({
    ...definition,
    release: Object.freeze({
      ...definition.release,
      artifactIdentity: definition.release.artifactIdentity
        ? Object.freeze({ ...definition.release.artifactIdentity })
        : null,
    }),
    runtime: Object.freeze({
      ...definition.runtime,
      environmentVariables: Object.freeze(definition.runtime.environmentVariables.map((item) => Object.freeze({ ...item }))),
    }),
    health: Object.freeze({ ...definition.health }),
    storage: Object.freeze({ ...definition.storage }),
    capabilities: Object.freeze({
      ...definition.capabilities,
      imChannels: Object.freeze([...definition.capabilities.imChannels]),
    }),
    lifecycle: Object.freeze({
      conversation: Object.freeze({ modes: Object.freeze([...definition.lifecycle.conversation.modes]) }),
      cancellation: Object.freeze({ ...definition.lifecycle.cancellation }),
      terminal: Object.freeze({ ...definition.lifecycle.terminal }),
      interactions: Object.freeze({ ...definition.lifecycle.interactions }),
    }),
    resources: Object.freeze({ ...definition.resources }),
    backup: Object.freeze({
      includePaths: Object.freeze([...definition.backup.includePaths]),
      excludePatterns: Object.freeze([...definition.backup.excludePatterns]),
    }),
  });
}

export const HERMES_RUNTIME_DEFINITION = freezeRuntimeDefinition({
  specVersion: "1.0.0",
  name: "hermes-agent",
  displayName: "Hermes Agent",
  version: "v2026.8.27",
  description: "Certified Hermes Agent v2026.8.27 runtime supported by the current MyBay Open Source preview.",
  providerKey: "hermes-core",
  contractVersion: 1,
  release: {
    supportStatus: "available",
    certificationLevel: "certified",
    deploymentSupported: true,
    bridgeVersion: null,
    artifactIdentity: {
      kind: "oci-digest",
      value: "sha256:e0df6adebddf29b91112aefc999d4aaf6846c9eb544faca5672a16a13590ff79",
    },
  },
  runtime: {
    type: "hermes",
    image: "nousresearch/hermes-agent",
    tag: "v2026.8.27",
    internalPort: 9119,
    environmentVariables: [
      {
        name: "HERMES_API_KEY",
        description: "Authentication token for internal REST endpoints",
        required: true,
        sensitive: true,
      },
      {
        name: "OPENAI_API_KEY",
        description: "Default model provider API key",
        required: true,
        sensitive: true,
      },
    ],
  },
  health: {
    endpoint: "/health",
    intervalSeconds: 30,
    timeoutSeconds: 10,
    expectedStatusCode: 200,
  },
  storage: {
    dataPath: "/opt/data",
    configPath: "/opt/hermes/config",
    volumeNamePrefix: "mybay-hermes-data",
  },
  capabilities: {
    chat: true,
    fileUpload: true,
    scheduledTasks: true,
    browser: true,
    shell: true,
    imChannels: ["web", "telegram", "feishu", "weixin", "slack", "webhook", "api"],
  },
  lifecycle: {
    conversation: { modes: ["streaming", "batch"] },
    cancellation: { supported: true, granularity: "run" },
    terminal: { observation: "status" },
    interactions: { approvals: true, questions: false },
  },
  resources: {
    minimumMemory: "512Mi",
    recommendedMemory: "1Gi",
    minimumCpu: 0.5,
  },
  backup: {
    includePaths: ["/opt/data", "/opt/hermes/config"],
    excludePatterns: ["*.log", "tmp/*"],
  },
});

export const PI_RUNTIME_DEFINITION = freezeRuntimeDefinition({
  specVersion: "1.0.0",
  name: "pi-agent",
  displayName: "Pi Agent",
  version: "0.85.1",
  description: "Certified MyBay integration for Pi Agent 0.85.1, with isolated web conversations and persisted file workflows.",
  providerKey: "pi-rpc",
  contractVersion: 1,
  release: {
    supportStatus: "available",
    certificationLevel: "certified",
    deploymentSupported: true,
    bridgeVersion: "0.1.1-beta",
    artifactIdentity: {
      kind: "docker-image-id",
      value: "sha256:b2ad5cf15c9f79a826a72ebda523b45ee2de80e53e438952227e06a8d79e0aa0",
    },
  },
  runtime: {
    type: "pi",
    image: "mybay/pi-runtime",
    tag: "0.85.1",
    internalPort: 8080,
    environmentVariables: [
      {
        name: "PI_BRIDGE_API_KEY",
        description: "Authentication token for internal REST endpoints",
        required: true,
        sensitive: true,
      },
      {
        name: "PI_PROVIDER",
        description: "Pi model provider identifier",
        required: true,
        sensitive: false,
      },
      {
        name: "PI_MODEL",
        description: "Pi model identifier",
        required: true,
        sensitive: false,
      },
    ],
  },
  health: {
    endpoint: "/health",
    intervalSeconds: 20,
    timeoutSeconds: 5,
    expectedStatusCode: 200,
  },
  storage: {
    dataPath: "/opt/data",
    configPath: "/opt/data/pi",
    volumeNamePrefix: "mybay-pi-data",
  },
  capabilities: {
    chat: true,
    fileUpload: true,
    scheduledTasks: false,
    browser: false,
    shell: true,
    imChannels: ["web"],
  },
  lifecycle: {
    conversation: { modes: ["streaming"] },
    cancellation: { supported: true, granularity: "run" },
    terminal: { observation: "events" },
    interactions: { approvals: true, questions: true },
  },
  resources: {
    minimumMemory: "512Mi",
    recommendedMemory: "1Gi",
    minimumCpu: 0.5,
  },
  backup: {
    includePaths: ["/opt/data/pi", "/opt/data/workspace"],
    excludePatterns: ["*.log", "tmp/*"],
  },
});

export const CODEX_RUNTIME_DEFINITION = freezeRuntimeDefinition({
  specVersion: "1.0.0", name: "codex-agent", displayName: "Codex", version: CODEX_BUILD.nativeVersion,
  description: "Experimental Codex App Server Runtime with isolated native sessions.",
  providerKey: "codex-app-server", contractVersion: 1,
  release: {
    supportStatus: "available", certificationLevel: "experimental", deploymentSupported: true,
    bridgeVersion: CODEX_BUILD.bridgeVersion,
    artifactIdentity: {
      kind: "docker-image-id",
      value: "sha256:20b46c8407fa9f4a40435653db85b00518d9fff132a7333b9482246357f42256",
    },
  },
  runtime: { type: "codex", image: CODEX_BUILD.image, tag: CODEX_BUILD.imageTag, internalPort: 8080,
    environmentVariables: [
      { name: "CODEX_BRIDGE_API_KEY", description: "Internal Runtime authentication", required: true, sensitive: true },
      { name: "CODEX_HOME", description: "Isolated native account and session directory", required: true, sensitive: false },
    ] },
  health: { endpoint: "/health", intervalSeconds: 20, timeoutSeconds: 5, expectedStatusCode: 200 },
  storage: { dataPath: "/opt/data", configPath: "/opt/data/codex", volumeNamePrefix: "mybay-codex-data" },
  capabilities: { chat: true, fileUpload: true, scheduledTasks: false, browser: false, shell: true, imChannels: ["web"] },
  lifecycle: { conversation: { modes: ["streaming"] }, cancellation: { supported: true, granularity: "run" },
    terminal: { observation: "events" }, interactions: { approvals: true, questions: false } },
  resources: { minimumMemory: "512Mi", recommendedMemory: "1Gi", minimumCpu: 0.5 },
  backup: { includePaths: ["/opt/data/codex", "/opt/data/codex-bridge", "/opt/data/workspace"], excludePatterns: ["*.log", "tmp/*"] },
});

export const RUNTIME_DEFINITIONS: readonly RuntimeDefinition[] = Object.freeze([
  HERMES_RUNTIME_DEFINITION,
  PI_RUNTIME_DEFINITION,
  CODEX_RUNTIME_DEFINITION,
]);

const runtimeDefinitionByType = new Map(
  RUNTIME_DEFINITIONS.map((definition) => [definition.runtime.type, definition]),
);

export function getRuntimeDefinition(runtimeType: RuntimeType): RuntimeDefinition {
  const definition = runtimeDefinitionByType.get(runtimeType);
  if (!definition) throw new Error(`Runtime definition is not registered: ${runtimeType}`);
  return definition;
}

export function toRuntimeManifest(definition: RuntimeDefinition): RuntimeManifest {
  const { providerKey: _providerKey, contractVersion: _contractVersion, ...manifest } = definition;
  return manifest;
}
