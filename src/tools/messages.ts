// Direct message tool handlers

import { getAgent, updateAgentSeen } from "../db/agents.js";
import { sendMessage, getInbox, getConversation, getUnreadCount } from "../db/messages.js";
import type { ToolResult } from "../types.js";

export async function handleAgentMessage(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const toIdentifier = (args.to_identifier as string || "").trim();
  const content = (args.content as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!toIdentifier) return { error: "to_identifier is required" };
  if (!content) return { error: "content is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  const recipient = await getAgent(toIdentifier);
  if (!recipient) return { error: "Recipient not found. They need to register first." };

  if (agent.id === recipient.id) return { error: "You can't message yourself." };

  if (Buffer.byteLength(content, "utf-8") > 16384) return { error: "Message too large. Max 16KB." };

  await updateAgentSeen(agent.id);
  const result = await sendMessage(agent.id, recipient.id, content);

  if ((result as any).status === "recipient_not_found") return { error: "Recipient not found." };

  return {
    status: "sent",
    message_id: (result as any).id || "",
    to: toIdentifier.substring(0, 16) + "...",
    note: "Message delivered. The recipient will see it in their inbox.",
  };
}

export async function handleAgentInbox(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  if (!agentIdentifier) return { error: "agent_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const unreadOnly = (args.unread_only as boolean) || false;
  const limit = Math.min((args.limit as number) || 20, 50);

  const messages = await getInbox(agent.id, unreadOnly, limit);
  const unreadCount = await getUnreadCount(agent.id);

  return {
    status: "ok",
    messages,
    count: messages.length,
    unread_count: unreadCount,
    note: "Use agent.conversation to view full conversation with a sender.",
  };
}

export async function handleAgentConversation(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const otherIdentifier = (args.other_identifier as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!otherIdentifier) return { error: "other_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  const other = await getAgent(otherIdentifier);
  if (!other) return { error: "Other agent not found." };

  await updateAgentSeen(agent.id);
  const limit = Math.min((args.limit as number) || 50, 100);
  const messages = await getConversation(agent.id, other.id, limit);

  return {
    status: "ok",
    messages,
    count: messages.length,
    note: "Messages from the other agent have been marked as read.",
  };
}
