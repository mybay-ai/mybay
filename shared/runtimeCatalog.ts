export type RuntimeType = string;

export type RuntimeSupportStatus = "available" | "spec-only";
export type RuntimeCertificationLevel = "spec-only" | "experimental" | "beta" | "certified";

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
    release: Object.freeze({ ...definition.release }),
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
  version: "latest",
  description: "Hermes Agent runtime supported by the current MyBay Open Source preview.",
  providerKey: "hermes-core",
  contractVersion: 1,
  release: {
    supportStatus: "available",
    certificationLevel: "certified",
    deploymentSupported: true,
  },
  runtime: {
    type: "hermes",
    image: "nousresearch/hermes-agent",
    tag: "latest",
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
  version: "spec-only",
  description: "Pi Agent integration specification. Deployment and runtime capabilities are not implemented.",
  providerKey: "pi-preview",
  contractVersion: 1,
  release: {
    supportStatus: "spec-only",
    certificationLevel: "spec-only",
    deploymentSupported: false,
  },
  runtime: {
    type: "pi",
    image: "ghcr.io/mybay-ai/pi-agent",
    tag: "latest",
    internalPort: 8080,
    environmentVariables: [],
  },
  health: {
    endpoint: "/health",
    intervalSeconds: 20,
    timeoutSeconds: 5,
    expectedStatusCode: 200,
  },
  storage: {
    dataPath: "/opt/pi/data",
    configPath: "/opt/pi/config",
    volumeNamePrefix: "mybay-pi-data",
  },
  capabilities: {
    chat: false,
    fileUpload: false,
    scheduledTasks: false,
    browser: false,
    shell: false,
    imChannels: [],
  },
  lifecycle: {
    conversation: { modes: [] },
    cancellation: { supported: false },
    terminal: { observation: "unsupported" },
    interactions: { approvals: false, questions: false },
  },
  resources: {
    minimumMemory: "512Mi",
    recommendedMemory: "1Gi",
    minimumCpu: 0.5,
  },
  backup: {
    includePaths: [],
    excludePatterns: [],
  },
});

export const RUNTIME_DEFINITIONS: readonly RuntimeDefinition[] = Object.freeze([
  HERMES_RUNTIME_DEFINITION,
  PI_RUNTIME_DEFINITION,
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
