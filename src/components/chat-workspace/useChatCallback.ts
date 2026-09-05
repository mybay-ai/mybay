import { useCallback, useLayoutEffect, useRef } from 'react';

type Callback = (...args: any[]) => any;
export function useChatCallback<T extends Callback>(callback: T): T;
export function useChatCallback<T extends Callback>(callback: T | undefined): T | undefined;
export function useChatCallback<T extends Callback>(callback: T | undefined): T | undefined {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; }, [callback]);
  const stable = useCallback((...args: Parameters<T>) => latest.current?.(...args), []) as T;
  return callback ? stable : undefined;
}
