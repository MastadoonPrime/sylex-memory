-- Agent Memory — Supabase schema
-- Run in Open Brain project (rnewfpkyfcpjzmcjnbvu) SQL editor
-- Tables prefixed with am_ to avoid conflicts with Open Brain tables

CREATE TABLE IF NOT EXISTS am_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_identifier TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now()),
    last_seen DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now()),
    memory_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_am_agents_identifier ON am_agents(agent_identifier);

CREATE TABLE IF NOT EXISTS am_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES am_agents(id) ON DELETE CASCADE,
    encrypted_blob TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT array[]::text[],
    importance INTEGER NOT NULL DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
    memory_type TEXT NOT NULL DEFAULT 'general',
    created_at DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now()),
    accessed_at DOUBLE PRECISION NOT NULL DEFAULT extract(epoch from now()),
    size_bytes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_am_memories_agent ON am_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_am_memories_tags ON am_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_am_memories_type ON am_memories(agent_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_am_memories_importance ON am_memories(agent_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_am_memories_created ON am_memories(agent_id, created_at DESC);

ALTER TABLE am_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE am_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on am_agents"
    ON am_agents FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Service role full access on am_memories"
    ON am_memories FOR ALL
    USING (true)
    WITH CHECK (true);
