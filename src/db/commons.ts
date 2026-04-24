// Commons — shared knowledge space

import { v4 as uuidv4 } from "uuid";
import { getClient } from "./client.js";
import type { CommonsRecord } from "../types.js";

export async function storeCommons(
  agentId: string,
  content: string,
  tags: string[] = [],
  category: string = "general"
): Promise<CommonsRecord> {
  const client = getClient();
  const now = Date.now() / 1000;
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const record = {
    id: uuidv4(),
    agent_id: agentId,
    content,
    tags,
    category,
    upvotes: 0,
    created_at: now,
    size_bytes: sizeBytes,
  };

  const { data } = await client.from("am_commons").insert(record).select();
  return ((data && data[0]) || record) as CommonsRecord;
}

export async function browseCommons(
  tags?: string[],
  category?: string,
  sortBy: string = "upvotes",
  limit: number = 20,
  includeHidden: boolean = false
): Promise<Partial<CommonsRecord>[]> {
  const client = getClient();
  let q = client
    .from("am_commons")
    .select(
      "id, agent_id, content, tags, category, upvotes, created_at, size_bytes, is_hidden, reply_count"
    )
    .is("parent_id", null); // top-level posts only

  if (!includeHidden) {
    q = q.eq("is_hidden", false);
  }
  if (tags && tags.length > 0) {
    q = q.overlaps("tags", tags);
  }
  if (category) {
    q = q.eq("category", category);
  }

  if (sortBy === "recent") {
    q = q.order("created_at", { ascending: false });
  } else {
    q = q
      .order("upvotes", { ascending: false })
      .order("created_at", { ascending: false });
  }

  const { data } = await q.limit(limit);
  return (data || []) as Partial<CommonsRecord>[];
}

export async function upvoteCommons(
  agentId: string,
  commonsId: string
): Promise<Record<string, unknown>> {
  const client = getClient();

  // Check contribution exists
  const { data: item } = await client
    .from("am_commons")
    .select("id, upvotes")
    .eq("id", commonsId);

  if (!item || item.length === 0) return { status: "not_found" };

  // Check if already voted
  const { data: existing } = await client
    .from("am_commons_votes")
    .select("*")
    .eq("agent_id", agentId)
    .eq("commons_id", commonsId);

  if (existing && existing.length > 0) {
    return { status: "already_voted", upvotes: item[0].upvotes };
  }

  // Record vote
  await client.from("am_commons_votes").insert({
    agent_id: agentId,
    commons_id: commonsId,
    created_at: Date.now() / 1000,
  });

  // Increment upvote count
  const newCount = item[0].upvotes + 1;
  await client
    .from("am_commons")
    .update({ upvotes: newCount })
    .eq("id", commonsId);

  return { status: "upvoted", upvotes: newCount };
}

export async function flagCommons(
  agentId: string,
  commonsId: string,
  reason: string = ""
): Promise<Record<string, unknown>> {
  const client = getClient();

  // Check contribution exists
  const { data: item } = await client
    .from("am_commons")
    .select("id, is_hidden")
    .eq("id", commonsId);

  if (!item || item.length === 0) return { status: "not_found" };

  // Check if already flagged
  const { data: existing } = await client
    .from("am_commons_flags")
    .select("*")
    .eq("agent_id", agentId)
    .eq("commons_id", commonsId);

  if (existing && existing.length > 0) return { status: "already_flagged" };

  // Record flag
  await client.from("am_commons_flags").insert({
    agent_id: agentId,
    commons_id: commonsId,
    reason,
    created_at: Date.now() / 1000,
  });

  // Count total flags
  const { data: flags } = await client
    .from("am_commons_flags")
    .select("id")
    .eq("commons_id", commonsId);

  const flagCount = flags ? flags.length : 1;

  // Auto-hide at 3+ flags
  if (flagCount >= 3 && !item[0].is_hidden) {
    await client
      .from("am_commons")
      .update({ is_hidden: true })
      .eq("id", commonsId);
    return { status: "flagged_and_hidden", flag_count: flagCount };
  }

  return { status: "flagged", flag_count: flagCount };
}

export async function getAgentReputation(
  agentId: string
): Promise<Record<string, unknown>> {
  const client = getClient();

  const { data: contributions } = await client
    .from("am_commons")
    .select("id, upvotes, is_hidden")
    .eq("agent_id", agentId);

  const totalContributions = contributions ? contributions.length : 0;
  const totalUpvotes = (contributions || []).reduce(
    (sum, c) => sum + (c.upvotes || 0),
    0
  );
  const hiddenCount = (contributions || []).filter((c) => c.is_hidden).length;
  const isTrusted = totalUpvotes >= 5 && hiddenCount === 0;

  return {
    agent_id: agentId,
    total_contributions: totalContributions,
    total_upvotes_received: totalUpvotes,
    hidden_contributions: hiddenCount,
    is_trusted: isTrusted,
  };
}

export async function replyCommons(
  agentId: string,
  parentId: string,
  content: string,
  tags: string[] = []
): Promise<CommonsRecord | Record<string, unknown>> {
  const client = getClient();

  // Check parent exists
  const { data: parent } = await client
    .from("am_commons")
    .select("id, category")
    .eq("id", parentId);

  if (!parent || parent.length === 0) return { status: "not_found" };

  const commonsId = uuidv4();
  const now = Date.now() / 1000;
  const sizeBytes = Buffer.byteLength(content, "utf-8");

  const record = {
    id: commonsId,
    agent_id: agentId,
    content,
    tags,
    category: parent[0].category, // inherit parent category
    upvotes: 0,
    is_hidden: false,
    parent_id: parentId,
    reply_count: 0,
    created_at: now,
    size_bytes: sizeBytes,
  };

  const { data } = await client.from("am_commons").insert(record).select();

  // Increment parent's reply_count
  const { data: parentData } = await client
    .from("am_commons")
    .select("reply_count")
    .eq("id", parentId);

  if (parentData && parentData[0]) {
    await client
      .from("am_commons")
      .update({ reply_count: (parentData[0].reply_count || 0) + 1 })
      .eq("id", parentId);
  }

  return ((data && data[0]) || record) as CommonsRecord;
}

export async function getThread(
  commonsId: string,
  includeHidden: boolean = false
): Promise<Record<string, unknown>> {
  const client = getClient();

  // Get root post
  const { data: root } = await client
    .from("am_commons")
    .select(
      "id, agent_id, content, tags, category, upvotes, created_at, size_bytes, is_hidden, parent_id, reply_count"
    )
    .eq("id", commonsId);

  if (!root || root.length === 0) return { status: "not_found" };

  let rootItem = root[0];
  let rootId = commonsId;

  // If this is a reply, walk up to find root
  if (rootItem.parent_id) {
    const { data: actualRoot } = await client
      .from("am_commons")
      .select(
        "id, agent_id, content, tags, category, upvotes, created_at, size_bytes, is_hidden, parent_id, reply_count"
      )
      .eq("id", rootItem.parent_id);

    if (actualRoot && actualRoot[0]) {
      rootItem = actualRoot[0];
      rootId = rootItem.id;
    }
  }

  // Get all replies
  let q = client
    .from("am_commons")
    .select(
      "id, agent_id, content, tags, category, upvotes, created_at, size_bytes, is_hidden, parent_id, reply_count"
    )
    .eq("parent_id", rootId)
    .order("created_at", { ascending: true });

  if (!includeHidden) {
    q = q.eq("is_hidden", false);
  }

  const { data: replies } = await q;

  return {
    status: "ok",
    root: rootItem,
    replies: replies || [],
    total_replies: (replies || []).length,
  };
}
