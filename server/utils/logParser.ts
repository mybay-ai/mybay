import { channelAuthEventsRepo, normalizeChannelAuthPlatform, type ChannelAuthEvent } from "../repositories/channelAuthEventsRepo";

export async function scanLogsForAuthEvents(instanceId: string, logs: string): Promise<ChannelAuthEvent[]> {
  const newlyCreated: ChannelAuthEvent[] = [];
  if (!logs) return newlyCreated;
  const lines = logs.split("\n");
  for (const line of lines) {
    // Normalise casing and spacing in the line to avoid parsing mismatches
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    const lowerLine = cleanLine.toLowerCase();
    // Check if line contains un-authorized signatures
    const isUnauthorized = lowerLine.includes("unauthorized") || 
                           lowerLine.includes("blocked unauthorized") || 
                           lowerLine.includes("not in allowlist") || 
                           lowerLine.includes("not allowed") || 
                           lowerLine.includes("access denied") || 
                           lowerLine.includes("denied access") ||
                           lowerLine.includes("whitelist denied");
                           
    if (!isUnauthorized) continue;

    let platform: string | null = null;
    let external_user_id: string | null = null;
    let external_chat_id: string | null = null;
    let external_channel_id: string | null = null;
    let external_group_id: string | null = null;
    let display_name: string | null = null;

    // 0. Telegram-specific high-priority matches
    const telegramMatch = cleanLine.match(/(?:Blocked\s+)?unauthorized\s+user\s+(-?\d+)\s+in\s+chat\s+(-?\d+)/i);
    const telegramChatMatch = cleanLine.match(/(?:Blocked\s+)?unauthorized\s+chat\s+(-?\d+)/i);
    const telegramUserMatch = cleanLine.match(/Telegram\s+unauthorized\s+user\s+(-?\d+)/i);

    // 1. Try Specific Regex Matches
    // Pattern A: "Unauthorized user: ou_xxx on feishu" or "Unauthorized user: ou_xxx (Name) on feishu"
    const matchUserOnPlatform = cleanLine.match(/Unauthorized user:\s*([^\s,:\(\)]+)(?:\s*\([^\)]*\))?\s+(?:on|platform=)\s*([^\s\)\n,:]+)/i);
    // Pattern B: "Unauthorized chat: Chat_123 on telegram" or "Unauthorized chat: Chat_123 (Name) on telegram"
    const matchChatOnPlatform = cleanLine.match(/Unauthorized chat:\s*([^\s,:\(\)]+)(?:\s*\([^\)]*\))?\s+(?:on|platform=)\s*([^\s\)\n,:]+)/i);
    // Pattern C: "Unauthorized channel: C12345 on slack" or "Unauthorized channel: C12345 (Name) on slack"
    const matchChannelOnPlatform = cleanLine.match(/Unauthorized channel:\s*([^\s,:\(\)]+)(?:\s*\([^\)]*\))?\s+(?:on|platform=)\s*([^\s\)\n,:]+)/i);
    // Pattern D: "Unauthorized group: G12345 on wecom" or "Unauthorized group: G12345 (Name) on wecom"
    const matchGroupOnPlatform = cleanLine.match(/Unauthorized group:\s*([^\s,:\(\)]+)(?:\s*\([^\)]*\))?\s+(?:on|platform=)\s*([^\s\)\n,:]+)/i);

    if (telegramMatch) {
      platform = "telegram";
      external_user_id = telegramMatch[1].trim();
      external_chat_id = telegramMatch[2].trim();
      display_name = `Telegram user ${external_user_id}`;
    } else if (telegramChatMatch) {
      platform = "telegram";
      external_chat_id = telegramChatMatch[1].trim();
      display_name = `Telegram chat ${external_chat_id}`;
    } else if (telegramUserMatch) {
      platform = "telegram";
      external_user_id = telegramUserMatch[1].trim();
      display_name = `Telegram user ${external_user_id}`;
    } else if (matchUserOnPlatform) {
      external_user_id = matchUserOnPlatform[1].trim();
      platform = matchUserOnPlatform[2].trim().toLowerCase();
    } else if (matchChatOnPlatform) {
      external_chat_id = matchChatOnPlatform[1].trim();
      platform = matchChatOnPlatform[2].trim().toLowerCase();
    } else if (matchChannelOnPlatform) {
      external_channel_id = matchChannelOnPlatform[1].trim();
      platform = matchChannelOnPlatform[2].trim().toLowerCase();
    } else if (matchGroupOnPlatform) {
      external_group_id = matchGroupOnPlatform[1].trim();
      platform = matchGroupOnPlatform[2].trim().toLowerCase();
    } else {
      // 2. Generic heuristics fallback
      // Find matching platform name in line
      const platforms = ["feishu", "lark", "telegram", "weixin", "wechat", "wecom", "wechat_work", "wechat_mp", "discord", "slack", "dingtalk", "whatsapp", "qqbot", "qq_bot", "webhook"];
      for (const p of platforms) {
        if (cleanLine.toLowerCase().includes(p)) {
          platform = p;
          break;
        }
      }

      // If no platform found but it contains lark/feishu IDs
      if (!platform) {
        if (cleanLine.includes("ou_") || cleanLine.includes("oc_")) {
          platform = "feishu";
        } else {
          // Default fallback
          platform = "feishu";
        }
      }

      // 3. Heuristic Key Extraction
      // Look for standard Feishu openid (ou_...) or chatid (oc_...)
      const feishuMatch = cleanLine.match(/\b(o[uc]_[a-zA-Z0-9_-]{8,})\b/);
      if (feishuMatch) {
         if (feishuMatch[1].startsWith("ou_")) {
           external_user_id = feishuMatch[1];
         } else {
           external_chat_id = feishuMatch[1];
         }
      }

      // Look for Numeric ID (Telegram chats have negative IDs, users positive. Usually 8-15 digits)
      const numericMatches = cleanLine.match(/(?:user|chat|sender|id|group)?\s*[:=\s]\s*(-\d+|\d{7,15})/i);
      if (numericMatches && !external_user_id && !external_chat_id) {
        const value = numericMatches[1];
        if (value.startsWith("-")) {
          external_chat_id = value;
        } else {
          external_user_id = value;
        }
      }

      // Fallback: If still nothing, extract the first contiguous non-space word after a colon that looks like an ID
      if (!external_user_id && !external_chat_id && !external_channel_id) {
        const colonMatch = cleanLine.match(/Unauthorized\s+(?:user|chat|channel|group|member)\s*:\s*([^\s,;]+)/i);
        if (colonMatch) {
          const matchedVal = colonMatch[1].trim();
          if (cleanLine.toLowerCase().includes("chat")) external_chat_id = matchedVal;
          else if (cleanLine.toLowerCase().includes("channel")) external_channel_id = matchedVal;
          else if (cleanLine.toLowerCase().includes("group")) external_group_id = matchedVal;
          else external_user_id = matchedVal;
        }
      }
    }

    // Standardize Platform Identifiers to sync with front-end options
    if (platform) {
      platform = normalizeChannelAuthPlatform(platform);
    }

    // Skip if we couldn't resolve any identifiers
    if (!platform || (!external_user_id && !external_chat_id && !external_channel_id && !external_group_id)) {
      continue;
    }

    // Parse display name if written in log, e.g. sender_name="Klaus"
    const nameMatch = cleanLine.match(/(?:name|user|display_name)\s*=\s*['"]?([^\s'"]+)['"]?/i);
    if (nameMatch) {
      display_name = nameMatch[1];
    } else if (!display_name) {
      display_name = external_user_id || external_chat_id || external_channel_id || external_group_id;
    }

    // Upsert into DB / local persistence
    try {
      const result = await channelAuthEventsRepo.upsertWithResult({
        instance_id: instanceId,
        platform,
        external_user_id: external_user_id || null,
        external_chat_id: external_chat_id || null,
        external_channel_id: external_channel_id || null,
        external_group_id: external_group_id || null,
        display_name: display_name,
        raw_payload: { log_line: cleanLine, timestamp: new Date().toISOString() }
      });
      if (result.created) newlyCreated.push(result.event);
    } catch (err) {
      console.error("[LogParser] Error saving captured channel auth event:", err);
    }
  }
  return newlyCreated;
}
