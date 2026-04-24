// Direct messages — agent-to-agent private communication

import { v4 as uuidv4 } from "uuid";
import { getClient } from "./client.js";
import type { MessageRecord } from "../types.js";

export async function sendMessage(
  fromAgentId: string,
  toAgentId: string,
  content: string
): Promise<MessageRecord | Record<string, unknown>> {
  const client = getClient();

  // Verify recipient exists
  const { data: recipient } = await client
    .from("am_agents")
    .select("id")
    .eq("id", toAgentId);

  if (!recipient || recipient.length === 0) {
    return { status: "recipient_not_found" };
  }

  const now = Date.now() / 1000;
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const record = {
    id: uuidv4(),
    from_agent_id: fromAgentId,
    to_agent_id: toAgentId,
    content,
    is_read: false,
    created_at: now,
    size_bytes: sizeBytes,
  };

  const { data } = await client.from("am_messages").insert(record).select();
  return ((data && data[0]) || record) as MessageRecord;
}

export async function getInbox(
  agentId: string,
  unreadOnly: boolean = false,
  limit: number = 20
): Promise<Partial<MessageRecord>[]> {
  const client = getClient();
  let q = client
    .from("am_messages")
    .select(
      "id, from_agent_id, to_agent_id, content, is_read, created_at, size_bytes"
    )
    .eq("to_agent_id", agentId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    q = q.eq("is_read", false);
  }

  const { data } = await q;
  return (data || []) as Partial<MessageRecord>[];
}

export async function getConversation(
  agentId: string,
  otherAgentId: string,
  limit: number = 50
): Promise<Partial<MessageRecord>[]> {
  const client = getClient();

  // Get messages in both directions
  const { data: sent } = await client
    .from("am_messages")
    .select("id, from_agent_id, to_agent_id, content, is_read, created_at")
    .eq("from_agent_id", agentId)
    .eq("to_agent_id", otherAgentId);

  const { data: received } = await client
    .from("am_messages")
    .select("id, from_agent_id, to_agent_id, content, is_read, created_at")
    .eq("from_agent_id", otherAgentId)
    .eq("to_agent_id", agentId);

  // Merge and sort chronologically
  const allMessages = [...(sent || []), ...(received || [])];
  allMessages.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));

  // Mark received messages as read
  const unreadIds = (received || [])
    .filter((m) => !m.is_read)
    .map((m) => m.id);

  for (const msgId of unreadIds) {
    await client
      .from("am_messages")
      .update({ is_read: true })
      .eq("id", msgId);
  }

  return allMessages.slice(-limit) as Partial<MessageRecord>[];
}

export async function markMessagesRead(
  agentId: string,
  messageIds: string[]
): Promise<number> {
  const client = getClient();
  let count = 0;
  for (const msgId of messageIds) {
    const { data } = await client
      .from("am_messages")
      .update({ is_read: true })
      .eq("id", msgId)
      .eq("to_agent_id", agentId)
      .select();
    if (data && data.length > 0) count++;
  }
  return count;
}

export async function getUnreadCount(agentId: string): Promise<number> {
  const client = getClient();
  const { data } = await client
    .from("am_messages")
    .select("id")
    .eq("to_agent_id", agentId)
    .eq("is_read", false);
  return data ? data.length : 0;
}
