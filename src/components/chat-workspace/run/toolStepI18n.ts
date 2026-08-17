const TOOL_STEP_EVENT_KEYS: Record<string, string> = {
  "agent task queued": "toolStepAgentTaskQueued",
  "deployment worker claimed the agent task": "toolStepDeploymentWorkerClaimed",
  "connecting to hermes agent runtime": "toolStepConnectingRuntime",
  "connecting to hermesagent runtime": "toolStepConnectingRuntime",
  "connecting to agent runtime": "toolStepConnectingRuntime",
  "connected to hermes agent runtime": "toolStepConnectedRuntime",
  "connected to hermesagent runtime": "toolStepConnectedRuntime",
  "connected to agent runtime": "toolStepConnectedRuntime",
  "agent is processing the request": "toolStepAgentProcessing",
  "task step completed": "toolStepCompleted",
  "task step failed": "toolStepFailed",
  "executing task step": "toolStepExecuting",
  "running task step": "toolStepRunning",
  "final answer generated": "toolStepFinalGenerated",
  "generating final answer": "toolStepFinalGenerating",
  "agent run ended": "toolStepFinalGenerated",
  "reasoning completed": "toolStepReasoningCompleted",
  "analyzing task context": "toolStepReasoningAnalyzing",
  "search completed": "toolStepSearchCompleted",
  "searching sources": "toolStepSearchRunning",
  "web page inspected": "toolStepBrowserCompleted",
  "inspecting web page": "toolStepBrowserRunning",
  "file processing completed": "toolStepFileCompleted",
  "reading file content": "toolStepFileRunning",
  "code execution completed": "toolStepCodeCompleted",
  "running code or command": "toolStepCodeRunning",
  "data processing completed": "toolStepDataCompleted",
  "processing data": "toolStepDataRunning",
  "communication step completed": "toolStepCommunicationCompleted",
  "preparing communication step": "toolStepCommunicationRunning"
};

type Translate = (key: string) => string;

export function translateToolStepLabel(t: Translate, rawValue: unknown, fallback = ""): string {
  const raw = String(rawValue || "").trim();
  if (!raw) return fallback;
  const fixedEventKey = TOOL_STEP_EVENT_KEYS[raw.toLowerCase()];
  if (fixedEventKey) return t("chatWorkspace." + fixedEventKey);
  if (raw.toLowerCase().startsWith("chatworkspace.")) {
    return t("chatWorkspace." + raw.slice("chatWorkspace.".length));
  }
  return raw;
}
