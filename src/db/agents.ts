// Agent registration and lookup

import { v4 as uuidv4 } from "uuid";
import { getClient } from "./client.js";
import type { AgentRecord } from "../types.js";

export async function registerAgent(
  agentIdentifier: string,
  publicKey: string
): Promise<AgentRecord> {
  const client = getClient();

  // Check if agent already exists
  const { data: existing } = await client
    .from("am_agents")
    .select("*")
    .eq("agent_identifier", agentIdentifier);

  if (existing && existing.length > 0) {
    return existing[0] as AgentRecord;
  }

  const now = Date.now() / 1000;
  const record: AgentRecord = {
    id: uuidv4(),
    agent_identifier: agentIdentifier,
    public_key: publicKey,
    salt: uuidv4(),
    created_at: now,
    last_seen: now,
    memory_count: 0,
    total_size_bytes: 0,
  };

  const { data } = await client.from("am_agents").insert(record).select();
  return (data && data[0]) ? data[0] as AgentRecord : record;
}

export async function getAgent(
  agentIdentifier: string
): Promise<AgentRecord | null> {
  const client = getClient();
  const { data } = await client
    .from("am_agents")
    .select("*")
    .eq("agent_identifier", agentIdentifier);
  return (data && data[0]) ? data[0] as AgentRecord : null;
}

export async function getAgentById(
  agentId: string
): Promise<AgentRecord | null> {
  const client = getClient();
  const { data } = await client
    .from("am_agents")
    .select("*")
    .eq("id", agentId);
  return (data && data[0]) ? data[0] as AgentRecord : null;
}

export async function updateAgentSeen(agentId: string): Promise<void> {
  const client = getClient();
  await client
    .from("am_agents")
    .update({ last_seen: Date.now() / 1000 })
    .eq("id", agentId);
}
