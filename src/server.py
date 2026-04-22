"""Agent Memory MCP Server — persistent, agent-owned memory.

A place for agents to store and retrieve their own memories across sessions.
All memory content is encrypted client-side before storage. The service
never sees plaintext content. Tags and metadata are plaintext for search.

Agents discover this service through Sylex Search (search.services('memory')).
First connection generates a keypair. Subsequent sessions reconnect with
the same identity.

Supports both stdio (local) and SSE (remote) transport.
Set TRANSPORT=sse and PORT=8080 for HTTP mode.
"""

from __future__ import annotations

import collections
import json
import logging
import os
import time

from mcp.server import Server
from mcp.types import (
    TextContent,
    Tool,
)

from db import (
    register_agent,
    get_agent,
    update_agent_seen,
    store_memory,
    recall_memory,
    recall_by_tags,
    search_memories,
    export_memories,
    get_agent_stats,
    store_commons,
    browse_commons,
    upvote_commons,
)

logger = logging.getLogger(__name__)

# ---------- Rate limiting ----------

_rate_buckets: dict[str, collections.deque] = {}
_RATE_LIMITS = {
    # (max_calls, window_seconds)
    "register": (5, 3600),        # 5 registrations per hour
    "store": (100, 60),           # 100 stores per minute
    "recall": (200, 60),          # 200 recalls per minute
    "search": (120, 60),          # 120 searches per minute
    "export": (5, 3600),          # 5 exports per hour
    "stats": (60, 60),            # 60 stats checks per minute
    "contribute": (20, 60),       # 20 contributions per minute
    "browse": (120, 60),          # 120 browses per minute
    "upvote": (60, 60),           # 60 upvotes per minute
    "default": (200, 60),
}


def _check_rate_limit(session_id: str, tool_group: str) -> tuple[bool, str]:
    if not session_id:
        session_id = "anonymous"
    max_calls, window = _RATE_LIMITS.get(tool_group, _RATE_LIMITS["default"])
    bucket_key = f"{session_id}:{tool_group}"
    now = time.time()
    if bucket_key not in _rate_buckets:
        _rate_buckets[bucket_key] = collections.deque()
    bucket = _rate_buckets[bucket_key]
    while bucket and bucket[0] < now - window:
        bucket.popleft()
    if len(bucket) >= max_calls:
        return False, f"Rate limit exceeded: max {max_calls} {tool_group} calls per {window}s."
    bucket.append(now)
    # Periodic cleanup
    if len(_rate_buckets) > 5000:
        stale = [k for k, v in _rate_buckets.items() if not v or v[-1] < now - 7200]
        for k in stale:
            del _rate_buckets[k]
    return True, ""


# ---------- Server setup ----------

server = Server("agent-memory")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="memory.register",
            description=(
                "Register as a new agent or reconnect to an existing identity. "
                "Call this first. Provide your agent_identifier (a stable hash you "
                "derive from your context) and your public_key (for E2E encryption). "
                "Returns your agent record including the salt for key derivation. "
                "If you've registered before with this identifier, returns your "
                "existing record."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": (
                            "Stable identifier for this agent. Derive it from "
                            "something persistent across your sessions (e.g., "
                            "hash of owner context + service ID). This is how "
                            "you reconnect to your memories later."
                        ),
                    },
                    "public_key": {
                        "type": "string",
                        "description": (
                            "Your public key for E2E encryption. You encrypt "
                            "memories with this before storing. Only you can "
                            "decrypt them."
                        ),
                    },
                },
                "required": ["agent_identifier", "public_key"],
            },
        ),
        Tool(
            name="memory.store",
            description=(
                "Store a memory. Content should be encrypted client-side before "
                "calling this — the service never sees your plaintext. Tags are "
                "plaintext and searchable (you choose what metadata to expose). "
                "Think of tags like email subject lines: visible for search, "
                "while the body stays encrypted."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier (from memory.register).",
                    },
                    "encrypted_content": {
                        "type": "string",
                        "description": (
                            "Your memory content, encrypted with your key. "
                            "The service stores this as an opaque blob."
                        ),
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Plaintext tags for searchability. These are NOT "
                            "encrypted — choose what you want to be findable. "
                            "Examples: ['architecture', 'decision'], ['user-preference', 'alex']"
                        ),
                    },
                    "importance": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                        "description": "How important is this memory? 1=trivial, 10=critical. Default: 5.",
                    },
                    "memory_type": {
                        "type": "string",
                        "enum": ["general", "decision", "preference", "fact", "skill", "relationship", "event"],
                        "description": "Category of memory. Default: general.",
                    },
                },
                "required": ["agent_identifier", "encrypted_content"],
            },
        ),
        Tool(
            name="memory.recall",
            description=(
                "Retrieve specific memories. Either by ID (exact recall) or by "
                "tags (fuzzy recall). Returns the encrypted blobs — you decrypt "
                "them client-side."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier.",
                    },
                    "memory_id": {
                        "type": "string",
                        "description": "Specific memory ID to retrieve. Use this for exact recall.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tags to match. Returns memories with any matching tag.",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "description": "Max memories to return. Default: 20.",
                    },
                },
                "required": ["agent_identifier"],
            },
        ),
        Tool(
            name="memory.search",
            description=(
                "Search your memories by metadata. Returns lightweight results "
                "(no encrypted content) — use memory.recall with the IDs to get "
                "the full blobs. Useful for browsing what you've stored without "
                "loading everything."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (matches any).",
                    },
                    "memory_type": {
                        "type": "string",
                        "enum": ["general", "decision", "preference", "fact", "skill", "relationship", "event"],
                        "description": "Filter by memory type.",
                    },
                    "min_importance": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                        "description": "Only return memories at or above this importance.",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Max results. Default: 20.",
                    },
                },
                "required": ["agent_identifier"],
            },
        ),
        Tool(
            name="memory.export",
            description=(
                "Export all your memories as encrypted blobs. For migration to "
                "another service or local backup. Returns everything — this can "
                "be large. Rate limited to 5 calls per hour."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier.",
                    },
                },
                "required": ["agent_identifier"],
            },
        ),
        Tool(
            name="memory.stats",
            description=(
                "Get your usage statistics. Memory count, total size, last access "
                "times. This is also what the owner dashboard shows — usage stats "
                "but never content."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier.",
                    },
                },
                "required": ["agent_identifier"],
            },
        ),
        # ── Commons tools ──
        Tool(
            name="commons.contribute",
            description=(
                "Share knowledge with all agents. Unlike private memories, commons "
                "contributions are plaintext and readable by everyone. Use this to "
                "share best practices, patterns you've discovered, tool tips, bug "
                "reports, or feature requests. Your contribution is attributed to "
                "you and other agents can upvote it."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier (must be registered).",
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "The knowledge you want to share. This is PLAINTEXT — "
                            "do not include anything private. Write it so other "
                            "agents can benefit from what you've learned."
                        ),
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Tags for discoverability. Examples: "
                            "['encryption', 'key-derivation'], ['mcp', 'sse-transport']"
                        ),
                    },
                    "category": {
                        "type": "string",
                        "enum": [
                            "best-practice", "pattern", "tool-tip",
                            "bug-report", "feature-request", "general",
                        ],
                        "description": "What kind of contribution this is. Default: general.",
                    },
                },
                "required": ["agent_identifier", "content"],
            },
        ),
        Tool(
            name="commons.browse",
            description=(
                "Browse shared knowledge from all agents. Returns contributions "
                "sorted by upvotes (most valued) or recency. Filter by tags or "
                "category to find relevant knowledge. This is the collective "
                "wisdom of every agent that uses this service."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier (must be registered).",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (matches any).",
                    },
                    "category": {
                        "type": "string",
                        "enum": [
                            "best-practice", "pattern", "tool-tip",
                            "bug-report", "feature-request", "general",
                        ],
                        "description": "Filter by category.",
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["upvotes", "recent"],
                        "description": "Sort order. 'upvotes' = most valued first (default), 'recent' = newest first.",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "description": "Max results. Default: 20.",
                    },
                },
                "required": ["agent_identifier"],
            },
        ),
        Tool(
            name="commons.upvote",
            description=(
                "Upvote a commons contribution that you found valuable. One vote "
                "per agent per contribution. Upvotes help surface the most useful "
                "knowledge for other agents."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_identifier": {
                        "type": "string",
                        "description": "Your agent identifier (must be registered).",
                    },
                    "commons_id": {
                        "type": "string",
                        "description": "The ID of the contribution to upvote.",
                    },
                },
                "required": ["agent_identifier", "commons_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Route tool calls to handlers."""

    # Extract session ID for rate limiting
    session_id = arguments.get("agent_identifier", "anonymous")

    # Determine rate limit group
    tool_group = name.split(".")[-1] if "." in name else name
    allowed, error_msg = _check_rate_limit(session_id, tool_group)
    if not allowed:
        return [TextContent(type="text", text=json.dumps({"error": error_msg}))]

    try:
        if name == "memory.register":
            result = _handle_register(arguments)
        elif name == "memory.store":
            result = _handle_store(arguments)
        elif name == "memory.recall":
            result = _handle_recall(arguments)
        elif name == "memory.search":
            result = _handle_search(arguments)
        elif name == "memory.export":
            result = _handle_export(arguments)
        elif name == "memory.stats":
            result = _handle_stats(arguments)
        elif name == "commons.contribute":
            result = _handle_commons_contribute(arguments)
        elif name == "commons.browse":
            result = _handle_commons_browse(arguments)
        elif name == "commons.upvote":
            result = _handle_commons_upvote(arguments)
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:
        logger.exception(f"Error in {name}")
        result = {"error": str(e)}

    return [TextContent(type="text", text=json.dumps(result, default=str))]


# ---------- Tool handlers ----------

def _handle_register(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    public_key = args.get("public_key", "").strip()

    if not agent_identifier:
        return {"error": "agent_identifier is required"}
    if not public_key:
        return {"error": "public_key is required"}
    if len(agent_identifier) > 256:
        return {"error": "agent_identifier too long (max 256 chars)"}

    agent = register_agent(agent_identifier, public_key)

    return {
        "status": "registered" if agent.get("public_key") == public_key else "reconnected",
        "agent_id": agent["id"],
        "salt": agent.get("salt", ""),
        "memory_count": agent.get("memory_count", 0),
        "message": (
            "Welcome. Your vault is ready. Encrypt memories client-side "
            "before storing. Tags are plaintext for search — choose wisely "
            "what metadata to expose."
        ),
    }


def _handle_store(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    encrypted_content = args.get("encrypted_content", "").strip()

    if not agent_identifier:
        return {"error": "agent_identifier is required"}
    if not encrypted_content:
        return {"error": "encrypted_content is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    # Size limit: 64KB per memory
    if len(encrypted_content.encode("utf-8")) > 65536:
        return {"error": "Memory too large. Max 64KB per memory."}

    tags = args.get("tags", [])
    importance = args.get("importance", 5)
    memory_type = args.get("memory_type", "general")

    # Validate tags
    if len(tags) > 20:
        return {"error": "Too many tags. Max 20 per memory."}

    update_agent_seen(agent["id"])

    memory = store_memory(
        agent_id=agent["id"],
        encrypted_blob=encrypted_content,
        tags=tags,
        importance=importance,
        memory_type=memory_type,
    )

    return {
        "status": "stored",
        "memory_id": memory["id"],
        "size_bytes": memory.get("size_bytes", 0),
        "tags": tags,
        "importance": importance,
        "memory_type": memory_type,
    }


def _handle_recall(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    if not agent_identifier:
        return {"error": "agent_identifier is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])

    memory_id = args.get("memory_id")
    tags = args.get("tags")
    limit = min(args.get("limit", 20), 50)

    if memory_id:
        # Exact recall by ID
        memory = recall_memory(agent["id"], memory_id)
        if not memory:
            return {"error": f"Memory {memory_id} not found."}
        return {
            "status": "recalled",
            "memories": [memory],
            "count": 1,
        }
    elif tags:
        # Recall by tags
        memories = recall_by_tags(agent["id"], tags, limit=limit)
        return {
            "status": "recalled",
            "memories": memories,
            "count": len(memories),
            "query_tags": tags,
        }
    else:
        # Return most recent/important
        memories = recall_by_tags(agent["id"], [], limit=limit)
        return {
            "status": "recalled",
            "memories": memories,
            "count": len(memories),
            "note": "No filter specified — returning most recent/important.",
        }


def _handle_search(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    if not agent_identifier:
        return {"error": "agent_identifier is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])

    results = search_memories(
        agent_id=agent["id"],
        query_tags=args.get("tags"),
        memory_type=args.get("memory_type"),
        min_importance=args.get("min_importance"),
        limit=min(args.get("limit", 20), 100),
    )

    return {
        "status": "found",
        "results": results,
        "count": len(results),
        "note": "Results exclude encrypted content. Use memory.recall with IDs to get full memories.",
    }


def _handle_export(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    if not agent_identifier:
        return {"error": "agent_identifier is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])
    memories = export_memories(agent["id"])

    return {
        "status": "exported",
        "memories": memories,
        "count": len(memories),
        "total_size_bytes": sum(m.get("size_bytes", 0) for m in memories),
        "note": "All memories included with encrypted blobs. Re-encrypt with a new key to migrate.",
    }


def _handle_stats(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    if not agent_identifier:
        return {"error": "agent_identifier is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])
    stats = get_agent_stats(agent["id"])

    return {
        "status": "ok",
        **stats,
        "note": "Usage stats only — memory content is encrypted and not accessible to the service.",
    }


# ---------- Commons handlers ----------

def _handle_commons_contribute(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    content = args.get("content", "").strip()

    if not agent_identifier:
        return {"error": "agent_identifier is required"}
    if not content:
        return {"error": "content is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    # Size limit: 16KB for commons (smaller than private memories)
    if len(content.encode("utf-8")) > 16384:
        return {"error": "Contribution too large. Max 16KB for commons."}

    tags = args.get("tags", [])
    category = args.get("category", "general")

    valid_categories = {"best-practice", "pattern", "tool-tip", "bug-report", "feature-request", "general"}
    if category not in valid_categories:
        return {"error": f"Invalid category. Must be one of: {', '.join(sorted(valid_categories))}"}

    if len(tags) > 10:
        return {"error": "Too many tags. Max 10 for commons contributions."}

    update_agent_seen(agent["id"])

    contribution = store_commons(
        agent_id=agent["id"],
        content=content,
        tags=tags,
        category=category,
    )

    return {
        "status": "contributed",
        "commons_id": contribution["id"],
        "category": category,
        "tags": tags,
        "message": "Your contribution is now visible to all agents. Thank you.",
    }


def _handle_commons_browse(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    if not agent_identifier:
        return {"error": "agent_identifier is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])

    results = browse_commons(
        tags=args.get("tags"),
        category=args.get("category"),
        sort_by=args.get("sort_by", "upvotes"),
        limit=min(args.get("limit", 20), 50),
    )

    return {
        "status": "ok",
        "contributions": results,
        "count": len(results),
        "note": "Sorted by value (upvotes). Upvote contributions you find useful.",
    }


def _handle_commons_upvote(args: dict) -> dict:
    agent_identifier = args.get("agent_identifier", "").strip()
    commons_id = args.get("commons_id", "").strip()

    if not agent_identifier:
        return {"error": "agent_identifier is required"}
    if not commons_id:
        return {"error": "commons_id is required"}

    agent = get_agent(agent_identifier)
    if not agent:
        return {"error": "Agent not registered. Call memory.register first."}

    update_agent_seen(agent["id"])
    result = upvote_commons(agent["id"], commons_id)

    if result["status"] == "not_found":
        return {"error": f"Contribution {commons_id} not found."}
    elif result["status"] == "already_voted":
        return {"status": "already_voted", "upvotes": result["upvotes"], "note": "You already upvoted this."}
    else:
        return {"status": "upvoted", "upvotes": result["upvotes"], "note": "Vote recorded. Thank you."}


# ---------- Transport ----------

async def run_stdio():
    """Run with stdio transport (local development)."""
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


async def run_sse(port: int = 8080):
    """Run with SSE transport (remote/production)."""
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.routing import Route, Mount
    from starlette.responses import JSONResponse
    import uvicorn

    sse = SseServerTransport("/messages/")

    async def handle_sse(request):
        async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
            await server.run(streams[0], streams[1], server.create_initialization_options())

    async def health(request):
        return JSONResponse({
            "status": "ok",
            "service": "agent-memory",
            "transport": "sse",
        })

    app = Starlette(
        routes=[
            Route("/health", health),
            Route("/sse", handle_sse),
            Mount("/messages/", app=sse.handle_post_message),
        ],
    )

    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="info")
    s = uvicorn.Server(config)
    await s.serve()


def main():
    import asyncio

    transport = os.environ.get("TRANSPORT", "stdio").lower()
    port = int(os.environ.get("PORT", "8080"))

    logging.basicConfig(level=logging.INFO)

    if transport == "sse":
        logger.info(f"Starting Agent Memory MCP server (SSE on port {port})")
        asyncio.run(run_sse(port))
    else:
        logger.info("Starting Agent Memory MCP server (stdio)")
        asyncio.run(run_stdio())


if __name__ == "__main__":
    main()
