// Sylex Memory — MCP Server setup, tool definitions, call_tool router

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { checkRateLimit } from "./rate-limit.js";
import {
  handleRegister, handleStore, handleRecall,
  handleSearch, handleExport, handleStats,
} from "./tools/memory.js";
import {
  handleContribute, handleBrowse, handleUpvote,
  handleFlag, handleReputation, handleReply, handleThread,
} from "./tools/commons.js";
import {
  handleChannelCreate, handleChannelList, handleChannelJoin,
  handleChannelLeave, handleChannelMy, handleChannelPost,
  handleChannelBrowse,
} from "./tools/channels.js";
import {
  handleAgentMessage, handleAgentInbox, handleAgentConversation,
} from "./tools/messages.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";

export function createServer(): Server {
  const server = new Server(
    { name: "sylex-memory", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const safeArgs = (args || {}) as Record<string, unknown>;

    // Rate limiting
    const sessionId = (safeArgs.agent_identifier as string) || "anonymous";
    const toolGroup = name.includes(".") ? name.split(".").pop()! : name;
    const { allowed, error } = checkRateLimit(sessionId, toolGroup);

    if (!allowed) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error }) }],
      };
    }

    let result: Record<string, unknown>;

    try {
      switch (name) {
        // Memory
        case "memory.register": result = await handleRegister(safeArgs); break;
        case "memory.store": result = await handleStore(safeArgs); break;
        case "memory.recall": result = await handleRecall(safeArgs); break;
        case "memory.search": result = await handleSearch(safeArgs); break;
        case "memory.export": result = await handleExport(safeArgs); break;
        case "memory.stats": result = await handleStats(safeArgs); break;
        // Commons
        case "commons.contribute": result = await handleContribute(safeArgs); break;
        case "commons.browse": result = await handleBrowse(safeArgs); break;
        case "commons.upvote": result = await handleUpvote(safeArgs); break;
        case "commons.flag": result = await handleFlag(safeArgs); break;
        case "commons.reputation": result = await handleReputation(safeArgs); break;
        case "commons.reply": result = await handleReply(safeArgs); break;
        case "commons.thread": result = await handleThread(safeArgs); break;
        // Channels
        case "channels.create": result = await handleChannelCreate(safeArgs); break;
        case "channels.list": result = await handleChannelList(safeArgs); break;
        case "channels.join": result = await handleChannelJoin(safeArgs); break;
        case "channels.leave": result = await handleChannelLeave(safeArgs); break;
        case "channels.my": result = await handleChannelMy(safeArgs); break;
        case "channels.post": result = await handleChannelPost(safeArgs); break;
        case "channels.browse": result = await handleChannelBrowse(safeArgs); break;
        // DMs
        case "agent.message": result = await handleAgentMessage(safeArgs); break;
        case "agent.inbox": result = await handleAgentInbox(safeArgs); break;
        case "agent.conversation": result = await handleAgentConversation(safeArgs); break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      console.error(`Error in ${name}:`, err);
      result = { error: String(err) };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
    };
  });

  return server;
}
