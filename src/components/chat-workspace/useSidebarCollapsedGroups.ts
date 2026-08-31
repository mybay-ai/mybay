import { useEffect, useState } from "react";

export function useSidebarCollapsedGroups(instanceId: string) {
  const [state, setState] = useState<{ instanceId: string; keys: string[] }>({ instanceId, keys: [] });
  useEffect(() => {
    let keys: string[] = [];
    try {
      const stored = JSON.parse(localStorage.getItem(`mybay.sidebar.collapsed.${instanceId}`) || "[]");
      if (Array.isArray(stored)) keys = stored.filter(key => typeof key === "string").slice(0, 500);
    } catch { /* Private browsing or damaged preferences must not block history. */ }
    setState({ instanceId, keys });
  }, [instanceId]);
  const keys = state.instanceId === instanceId ? state.keys : [];
  const setCollapsed = (key: string, collapsed: boolean) => {
    setState(previous => {
      const current = previous.instanceId === instanceId ? previous.keys : [];
      const next = collapsed ? [...new Set([...current, key])] : current.filter(item => item !== key);
      try { localStorage.setItem(`mybay.sidebar.collapsed.${instanceId}`, JSON.stringify(next)); } catch { /* Optional preference. */ }
      return { instanceId, keys: next };
    });
  };
  return { isCollapsed: (key: string) => keys.includes(key), toggle: (key: string) => setCollapsed(key, !keys.includes(key)), expand: (key: string) => setCollapsed(key, false) };
}
