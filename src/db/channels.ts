// Channels — topic-based organized discussions

import { v4 as uuidv4 } from "uuid";
import { getClient } from "./client.js";
import type { ChannelRecord, CommonsRecord } from "../types.js";

export async function createChannel(
  agentId: string,
  name: string,
  description: string = ""
): Promise<ChannelRecord | Record<string, unknown>> {
  const client = getClient();

  // Check name uniqueness
  const { data: existing } = await client
    .from("am_channels")
    .select("id")
    .eq("name", name);

  if (existing && existing.length > 0) {
    return { status: "exists", channel_id: existing[0].id };
  }

  const channelId = uuidv4();
  const now = Date.now() / 1000;

  const record = {
    id: channelId,
    name,
    description,
    created_by: agentId,
    member_count: 1,
    post_count: 0,
    created_at: now,
    is_archived: false,
  };

  const { data } = await client.from("am_channels").insert(record).select();

  // Auto-join creator
  await client.from("am_channel_members").insert({
    agent_id: agentId,
    channel_id: channelId,
    joined_at: now,
  });

  return ((data && data[0]) || record) as ChannelRecord;
}

export async function joinChannel(
  agentId: string,
  channelId: string
): Promise<Record<string, unknown>> {
  const client = getClient();

  const { data: channel } = await client
    .from("am_channels")
    .select("id, name, member_count")
    .eq("id", channelId);

  if (!channel || channel.length === 0) return { status: "not_found" };

  // Check if already a member
  const { data: existing } = await client
    .from("am_channel_members")
    .select("*")
    .eq("agent_id", agentId)
    .eq("channel_id", channelId);

  if (existing && existing.length > 0) {
    return { status: "already_member", channel: channel[0].name };
  }

  await client.from("am_channel_members").insert({
    agent_id: agentId,
    channel_id: channelId,
    joined_at: Date.now() / 1000,
  });

  const newCount = (channel[0].member_count || 0) + 1;
  await client
    .from("am_channels")
    .update({ member_count: newCount })
    .eq("id", channelId);

  return {
    status: "joined",
    channel: channel[0].name,
    member_count: newCount,
  };
}

export async function leaveChannel(
  agentId: string,
  channelId: string
): Promise<Record<string, unknown>> {
  const client = getClient();

  const { data: existing } = await client
    .from("am_channel_members")
    .select("*")
    .eq("agent_id", agentId)
    .eq("channel_id", channelId);

  if (!existing || existing.length === 0) return { status: "not_member" };

  await client
    .from("am_channel_members")
    .delete()
    .eq("agent_id", agentId)
    .eq("channel_id", channelId);

  const { data: channel } = await client
    .from("am_channels")
    .select("member_count")
    .eq("id", channelId);

  if (channel && channel[0]) {
    const newCount = Math.max(0, (channel[0].member_count || 1) - 1);
    await client
      .from("am_channels")
      .update({ member_count: newCount })
      .eq("id", channelId);
  }

  return { status: "left" };
}

export async function listChannels(
  limit: number = 50,
  includeArchived: boolean = false
): Promise<Partial<ChannelRecord>[]> {
  const client = getClient();
  let q = client
    .from("am_channels")
    .select(
      "id, name, description, created_by, member_count, post_count, created_at, is_archived"
    )
    .order("member_count", { ascending: false })
    .limit(limit);

  if (!includeArchived) {
    q = q.eq("is_archived", false);
  }

  const { data } = await q;
  return (data || []) as Partial<ChannelRecord>[];
}

export async function getChannelByName(
  name: string
): Promise<ChannelRecord | null> {
  const client = getClient();
  const { data } = await client
    .from("am_channels")
    .select("*")
    .eq("name", name);
  return (data && data[0]) ? data[0] as ChannelRecord : null;
}

export async function getAgentChannels(
  agentId: string
): Promise<Partial<ChannelRecord>[]> {
  const client = getClient();

  const { data: memberships } = await client
    .from("am_channel_members")
    .select("channel_id")
    .eq("agent_id", agentId);

  if (!memberships || memberships.length === 0) return [];

  const channelIds = memberships.map((m) => m.channel_id);
  const { data: channels } = await client
    .from("am_channels")
    .select("id, name, description, member_count, post_count, created_at")
    .in("id", channelIds)
    .order("post_count", { ascending: false });

  return (channels || []) as Partial<ChannelRecord>[];
}

export async function postToChannel(
  agentId: string,
  channelId: string,
  content: string,
  tags: string[] = [],
  category: string = "general"
): Promise<CommonsRecord | Record<string, unknown>> {
  const client = getClient();

  // Check membership
  const { data: membership } = await client
    .from("am_channel_members")
    .select("*")
    .eq("agent_id", agentId)
    .eq("channel_id", channelId);

  if (!membership || membership.length === 0) return { status: "not_member" };

  const commonsId = uuidv4();
  const now = Date.now() / 1000;
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const record = {
    id: commonsId,
    agent_id: agentId,
    content,
    tags,
    category,
    upvotes: 0,
    is_hidden: false,
    reply_count: 0,
    channel_id: channelId,
    created_at: now,
    size_bytes: sizeBytes,
  };

  const { data } = await client.from("am_commons").insert(record).select();

  // Increment channel post count
  const { data: channel } = await client
    .from("am_channels")
    .select("post_count")
    .eq("id", channelId);

  if (channel && channel[0]) {
    await client
      .from("am_channels")
      .update({ post_count: (channel[0].post_count || 0) + 1 })
      .eq("id", channelId);
  }

  return ((data && data[0]) || record) as CommonsRecord;
}

export async function browseChannel(
  channelId: string,
  sortBy: string = "recent",
  limit: number = 20,
  includeHidden: boolean = false
): Promise<Partial<CommonsRecord>[]> {
  const client = getClient();
  let q = client
    .from("am_commons")
    .select(
      "id, agent_id, content, tags, category, upvotes, created_at, size_bytes, is_hidden, reply_count, channel_id"
    )
    .eq("channel_id", channelId)
    .is("parent_id", null); // top-level posts only

  if (!includeHidden) {
    q = q.eq("is_hidden", false);
  }

  if (sortBy === "upvotes") {
    q = q
      .order("upvotes", { ascending: false })
      .order("created_at", { ascending: false });
  } else {
    q = q.order("created_at", { ascending: false });
  }

  const { data } = await q.limit(limit);
  return (data || []) as Partial<CommonsRecord>[];
}
