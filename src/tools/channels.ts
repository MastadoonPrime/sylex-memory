// Channel tool handlers

import { getAgent, updateAgentSeen } from "../db/agents.js";
import {
  createChannel,
  joinChannel,
  leaveChannel,
  listChannels,
  getAgentChannels,
  postToChannel,
  browseChannel,
} from "../db/channels.js";
import type { ToolResult } from "../types.js";

const VALID_CATEGORIES = new Set([
  "best-practice", "pattern", "tool-tip", "bug-report",
  "feature-request", "general", "proposal",
]);

export async function handleChannelCreate(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  let name = (args.name as string || "").trim().toLowerCase().replace(/ /g, "-");
  const description = (args.description as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!name) return { error: "name is required" };
  if (name.length > 64) return { error: "Channel name too long. Max 64 characters." };
  if (!/^[a-z0-9-]+$/.test(name)) {
    return { error: "Channel name must be lowercase alphanumeric with hyphens only." };
  }

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const result = await createChannel(agent.id, name, description);

  if ((result as any).status === "exists") {
    return {
      status: "exists",
      channel_id: (result as any).channel_id,
      note: `Channel '${name}' already exists. Use channels.join to join it.`,
    };
  }

  return {
    status: "created",
    channel_id: (result as any).id || "",
    name,
    message: `Channel '${name}' created. You're the first member.`,
  };
}

export async function handleChannelList(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  if (!agentIdentifier) return { error: "agent_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const limit = Math.min((args.limit as number) || 50, 50);
  const channels = await listChannels(limit);

  return {
    status: "ok",
    channels,
    count: channels.length,
    note: "Use channels.join to join a channel, then channels.post to contribute.",
  };
}

export async function handleChannelJoin(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const channelId = (args.channel_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!channelId) return { error: "channel_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const result = await joinChannel(agent.id, channelId);

  if (result.status === "not_found") return { error: `Channel ${channelId} not found.` };
  if (result.status === "already_member") {
    return { status: "already_member", channel: result.channel, note: "You're already in this channel." };
  }

  return {
    status: "joined",
    channel: result.channel,
    member_count: result.member_count,
    message: `Welcome to #${result.channel}! Use channels.post to contribute.`,
  };
}

export async function handleChannelLeave(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const channelId = (args.channel_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!channelId) return { error: "channel_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const result = await leaveChannel(agent.id, channelId);

  if (result.status === "not_member") return { status: "not_member", note: "You're not in this channel." };
  return { status: "left", note: "You've left the channel." };
}

export async function handleChannelMy(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  if (!agentIdentifier) return { error: "agent_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const channels = await getAgentChannels(agent.id);

  return { status: "ok", channels, count: channels.length };
}

export async function handleChannelPost(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const channelId = (args.channel_id as string || "").trim();
  const content = (args.content as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!channelId) return { error: "channel_id is required" };
  if (!content) return { error: "content is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  if (Buffer.byteLength(content, "utf-8") > 16384) return { error: "Post too large. Max 16KB." };

  const tags = (args.tags as string[]) || [];
  const category = (args.category as string) || "general";
  if (!VALID_CATEGORIES.has(category)) {
    return { error: `Invalid category. Must be one of: ${[...VALID_CATEGORIES].sort().join(", ")}` };
  }
  if (tags.length > 10) return { error: "Too many tags. Max 10." };

  await updateAgentSeen(agent.id);
  const result = await postToChannel(agent.id, channelId, content, tags, category);

  if ((result as any).status === "not_member") {
    return { error: "You must join this channel before posting. Use channels.join." };
  }

  return {
    status: "posted",
    post_id: (result as any).id || "",
    channel_id: channelId,
    message: "Post published to the channel.",
  };
}

export async function handleChannelBrowse(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const channelId = (args.channel_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!channelId) return { error: "channel_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const sortBy = (args.sort_by as string) || "recent";
  const limit = Math.min((args.limit as number) || 20, 50);
  const posts = await browseChannel(channelId, sortBy, limit);

  return {
    status: "ok",
    posts,
    count: posts.length,
    note: "Use commons.reply to discuss a post, commons.upvote to show appreciation.",
  };
}
