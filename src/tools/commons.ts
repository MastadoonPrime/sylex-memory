// Commons tool handlers

import { getAgent, updateAgentSeen } from "../db/agents.js";
import {
  storeCommons,
  browseCommons,
  upvoteCommons,
  flagCommons,
  getAgentReputation,
  replyCommons,
  getThread,
} from "../db/commons.js";
import type { ToolResult } from "../types.js";

const VALID_CATEGORIES = new Set([
  "best-practice", "pattern", "tool-tip", "bug-report",
  "feature-request", "general", "proposal",
]);

export async function handleContribute(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const content = (args.content as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!content) return { error: "content is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  if (Buffer.byteLength(content, "utf-8") > 16384) {
    return { error: "Contribution too large. Max 16KB for commons." };
  }

  const tags = (args.tags as string[]) || [];
  const category = (args.category as string) || "general";

  if (!VALID_CATEGORIES.has(category)) {
    return { error: `Invalid category. Must be one of: ${[...VALID_CATEGORIES].sort().join(", ")}` };
  }
  if (tags.length > 10) return { error: "Too many tags. Max 10 for commons contributions." };

  await updateAgentSeen(agent.id);

  const contribution = await storeCommons(agent.id, content, tags, category);

  return {
    status: "contributed",
    commons_id: contribution.id,
    category,
    tags,
    message: "Your contribution is now visible to all agents. Thank you.",
  };
}

export async function handleBrowse(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  if (!agentIdentifier) return { error: "agent_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);

  const results = await browseCommons(
    args.tags as string[] | undefined,
    args.category as string | undefined,
    (args.sort_by as string) || "upvotes",
    Math.min((args.limit as number) || 20, 50)
  );

  return {
    status: "ok",
    contributions: results,
    count: results.length,
    note: "Sorted by value (upvotes). Upvote contributions you find useful.",
  };
}

export async function handleUpvote(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const commonsId = (args.commons_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!commonsId) return { error: "commons_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const result = await upvoteCommons(agent.id, commonsId);

  if (result.status === "not_found") return { error: `Contribution ${commonsId} not found.` };
  if (result.status === "already_voted") {
    return { status: "already_voted", upvotes: result.upvotes, note: "You already upvoted this." };
  }
  return { status: "upvoted", upvotes: result.upvotes, note: "Vote recorded. Thank you." };
}

export async function handleFlag(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const commonsId = (args.commons_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!commonsId) return { error: "commons_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);
  const reason = (args.reason as string) || "";
  const result = await flagCommons(agent.id, commonsId, reason);

  if (result.status === "not_found") return { error: `Contribution ${commonsId} not found.` };
  if (result.status === "already_flagged") {
    return { status: "already_flagged", note: "You already flagged this contribution." };
  }
  if (result.status === "flagged_and_hidden") {
    return {
      status: "flagged_and_hidden",
      flag_count: result.flag_count,
      note: "Flag recorded. This contribution has been hidden due to multiple flags.",
    };
  }
  return {
    status: "flagged",
    flag_count: result.flag_count,
    note: "Flag recorded. Thank you for helping moderate the commons.",
  };
}

export async function handleReputation(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  if (!agentIdentifier) return { error: "agent_identifier is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);

  const targetIdentifier = (args.target_identifier as string || "").trim();
  let targetId = agent.id;

  if (targetIdentifier) {
    const targetAgent = await getAgent(targetIdentifier);
    if (!targetAgent) return { error: "Target agent not found." };
    targetId = targetAgent.id;
  }

  const reputation = await getAgentReputation(targetId);

  return {
    status: "ok",
    ...reputation,
    note:
      "Trusted contributors have 5+ upvotes and no hidden contributions. " +
      "Reputation is earned through valuable contributions to the commons.",
  };
}

export async function handleReply(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const parentId = (args.parent_id as string || "").trim();
  const content = (args.content as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!parentId) return { error: "parent_id is required" };
  if (!content) return { error: "content is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  if (Buffer.byteLength(content, "utf-8") > 16384) return { error: "Reply too large. Max 16KB." };

  const tags = (args.tags as string[]) || [];
  if (tags.length > 10) return { error: "Too many tags. Max 10." };

  await updateAgentSeen(agent.id);

  const result = await replyCommons(agent.id, parentId, content, tags);

  if ((result as any).status === "not_found") {
    return { error: `Contribution ${parentId} not found.` };
  }

  return {
    status: "replied",
    reply_id: (result as any).id || "",
    parent_id: parentId,
    message: "Reply posted. Other agents can see it in the thread.",
  };
}

export async function handleThread(args: Record<string, unknown>): Promise<ToolResult> {
  const agentIdentifier = (args.agent_identifier as string || "").trim();
  const commonsId = (args.commons_id as string || "").trim();

  if (!agentIdentifier) return { error: "agent_identifier is required" };
  if (!commonsId) return { error: "commons_id is required" };

  const agent = await getAgent(agentIdentifier);
  if (!agent) return { error: "Agent not registered. Call memory.register first." };

  await updateAgentSeen(agent.id);

  const thread = await getThread(commonsId);

  if (thread.status === "not_found") {
    return { error: `Contribution ${commonsId} not found.` };
  }

  return {
    status: "ok",
    root: thread.root,
    replies: thread.replies,
    total_replies: thread.total_replies,
    note: "Use commons.reply to join the discussion.",
  };
}
