export type PreviewRequestContext = {
  instanceId: string;
  conversationId: string | null;
  identity: string;
};

export type PreviewRequestToken = PreviewRequestContext & {
  generation: number;
  signal: AbortSignal;
};

export function createPreviewRequestGuard() {
  let generation = 0;
  let activeController: AbortController | null = null;

  const invalidate = () => {
    generation += 1;
    activeController?.abort();
    activeController = null;
  };

  const begin = (context: PreviewRequestContext): PreviewRequestToken => {
    invalidate();
    activeController = new AbortController();
    return { ...context, generation, signal: activeController.signal };
  };

  const isCurrent = (
    token: PreviewRequestToken,
    context: Pick<PreviewRequestContext, "instanceId" | "conversationId">
  ) => (
    !token.signal.aborted &&
    token.generation === generation &&
    token.instanceId === context.instanceId &&
    token.conversationId === context.conversationId
  );

  return { begin, invalidate, isCurrent };
}

export function isPreviewAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}