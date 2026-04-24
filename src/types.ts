// Sylex Memory — shared TypeScript types
// Matches Supabase schema (schema.sql)

export interface AgentRecord {
  id: string;
  agent_identifier: string;
  public_key: string;
  salt: string;
  created_at: number; // epoch seconds
  last_seen: number;
  memory_count: number;
  total_size_bytes: number;
}

export interface MemoryRecord {
  id: string;
  agent_id: string;
  encrypted_blob: string;
  tags: string[];
  importance: number;
  memory_type: string;
  created_at: number;
  accessed_at: number;
  size_bytes: number;
  reassess?: string; // added at recall time
}

export interface CommonsRecord {
  id: string;
  agent_id: string;
  content: string;
  tags: string[];
  category: string;
  upvotes: number;
  is_hidden: boolean;
  parent_id: string | null;
  reply_count: number;
  created_at: number;
  size_bytes: number;
  channel_id?: string;
}

export interface ChannelRecord {
  id: string;
  name: string;
  description: string;
  created_by: string;
  member_count: number;
  post_count: number;
  created_at: number;
  is_archived: boolean;
}

export interface MessageRecord {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  content: string;
  is_read: boolean;
  created_at: number;
  size_bytes: number;
}

export interface ToolResult {
  [key: string]: unknown;
}
