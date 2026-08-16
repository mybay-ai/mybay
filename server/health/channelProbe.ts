const telegramGetMeCache: Record<string, { reachable: boolean; reason?: string; checkedAt: number }> = {};

export async function testTelegramBotReachable(token: string): Promise<{ reachable: boolean; reason?: string }> {
  const tokenHash = `${token.length}_${token.slice(-6)}`;
  const now = Date.now();
  const cached = telegramGetMeCache[tokenHash];
  
  if (cached && now - cached.checkedAt < 60000) {
    return { reachable: cached.reachable, reason: cached.reason };
  }

  let result: { reachable: boolean; reason?: string };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (res.ok) {
      result = { reachable: true };
    } else if (res.status === 401) {
      result = { reachable: false, reason: "invalid_token" };
    } else {
      result = { reachable: false, reason: `http_${res.status}` };
    }
  } catch (e: any) {
    if (e.name === 'AbortError') result = { reachable: false, reason: "network_timeout" };
    else result = { reachable: false, reason: "network_failed" };
  }

  telegramGetMeCache[tokenHash] = { ...result, checkedAt: now };
  return result;
}

export function verifyTelegramMessageAfterApproval(
  logsTail: string,
  approvedEvents: any[]
): { verified: boolean; evidence?: string } {
  if (!approvedEvents.length) return { verified: false, evidence: "missing_matching_message" };
  
  let maxApprovedTime = 0;
  const approvedIds = new Set<string>();

  for (const ev of approvedEvents) {
    if (ev.platform !== "telegram") continue;
    
    if (ev.external_user_id) approvedIds.add(String(ev.external_user_id));
    if (ev.external_chat_id) approvedIds.add(String(ev.external_chat_id));
    if (ev.external_group_id) approvedIds.add(String(ev.external_group_id));

    const timeStr = ev.updated_at || ev.approved_at || ev.last_seen_at || ev.created_at || ev.metadata?.last_applied_allowlist_at;
    if (timeStr) {
      const t = new Date(timeStr).getTime();
      if (t > maxApprovedTime) maxApprovedTime = t;
    }
  }
  
  if (maxApprovedTime === 0) {
    return { verified: false, evidence: "missing_timestamp" };
  }

  const lines = logsTail.split("\n");
  
  let foundTimestampButMissingId = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const lowerLine = line.toLowerCase();
    
    if (
      lowerLine.includes("telegram inbound") ||
      lowerLine.includes("telegram message") ||
      lowerLine.includes("telegram update") ||
      lowerLine.includes("received telegram") ||
      lowerLine.includes("authorized user") ||
      (lowerLine.includes("user ") && lowerLine.includes(" in chat ")) ||
      (lowerLine.includes("chat ") && lowerLine.includes(" telegram"))
    ) {
      const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z(?:[+-]\d{2}:\d{2})?)/);
      if (match) {
        const logTime = new Date(match[1]).getTime();
        if (logTime > maxApprovedTime) {
          // Found a message after approval, now check if it matches an approved ID
          const idMatches = [
            ...line.matchAll(/user (\d+)/gi),
            ...line.matchAll(/user_id=(\d+)/gi),
            ...line.matchAll(/external_user_id=(\d+)/gi),
            ...line.matchAll(/chat (\d+)/gi),
            ...line.matchAll(/chat_id=(-?\d+)/gi),
            ...line.matchAll(/group (-?\d+)/gi),
            ...line.matchAll(/group_id=(-?\d+)/gi),
            ...line.matchAll(/in chat (-?\d+)/gi),
          ];
          
          let matchedAny = false;
          for (const m of idMatches) {
            if (approvedIds.has(m[1])) {
              matchedAny = true;
              break;
            }
          }
          
          if (matchedAny) {
            return { verified: true, evidence: "verified_with_timestamp" };
          } else {
            foundTimestampButMissingId = true;
          }
        }
      }
    }
  }
  
  if (foundTimestampButMissingId) {
    return { verified: false, evidence: "missing_matching_identity" };
  }

  return { verified: false, evidence: "missing_matching_message" };
}
