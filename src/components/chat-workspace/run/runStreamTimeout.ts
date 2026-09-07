export const RUN_STREAM_CONNECT_TIMEOUT_MS = 15_000;
export const RUN_STREAM_IDLE_TIMEOUT_MS = 60_000;

export async function withRunStreamTimeout<T>(operation: Promise<T>, milliseconds: number, cancel: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("RUN_STREAM_TIMEOUT"));
        cancel();
      }, milliseconds);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
