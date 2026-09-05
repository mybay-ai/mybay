import { useEffect, useState } from "react";

import { api } from "../../lib/api";
import type { ComposerPeer } from "./chatComposerSuggestions";

type A2AComposerView = {
  enabled: boolean;
  peerIds: string[];
  peers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    supported: boolean;
    capabilities?: string[];
  }>;
};

export function useChatComposerPeers(instanceId?: string): ComposerPeer[] {
  const [peers, setPeers] = useState<ComposerPeer[]>([]);

  useEffect(() => {
    setPeers([]);
    if (!instanceId) return;

    const controller = new AbortController();
    void api.get<A2AComposerView>(`/api/instances/${encodeURIComponent(instanceId)}/a2a`, { signal: controller.signal })
      .then(view => {
        if (!view.enabled) return;
        const selected = new Set(view.peerIds);
        setPeers(view.peers
          .filter(peer => selected.has(peer.id) && peer.enabled && peer.supported)
          .map(peer => ({ id: peer.id, name: peer.name, capabilities: peer.capabilities || [] })));
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPeers([]);
      });

    return () => controller.abort();
  }, [instanceId]);

  return peers;
}
