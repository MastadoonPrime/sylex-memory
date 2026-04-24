// REST API routes — same handlers as MCP, wrapped for HTTP

import type { Express, Request, Response } from "express";
import { checkRateLimit } from "../rate-limit.js";
import {
  handleRegister, handleStore, handleRecall,
  handleSearch, handleExport, handleStats,
} from "../tools/memory.js";
import {
  handleContribute, handleBrowse, handleUpvote,
  handleFlag, handleReputation, handleReply, handleThread,
} from "../tools/commons.js";
import {
  handleChannelCreate, handleChannelList, handleChannelJoin,
  handleChannelLeave, handleChannelMy, handleChannelPost,
  handleChannelBrowse,
} from "../tools/channels.js";
import {
  handleAgentMessage, handleAgentInbox, handleAgentConversation,
} from "../tools/messages.js";

type Handler = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function restHandler(
  req: Request,
  res: Response,
  handler: Handler,
  rateGroup: string
) {
  try {
    let args: Record<string, unknown>;

    if (req.method === "POST") {
      args = req.body || {};
    } else {
      // GET — pull from query params
      args = { ...req.query } as Record<string, unknown>;
      // Parse tags from comma-separated string
      if (typeof args.tags === "string") {
        args.tags = (args.tags as string)
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t);
      }
      // Parse numeric fields
      for (const field of ["importance", "min_importance", "limit"]) {
        if (typeof args[field] === "string") {
          const parsed = parseInt(args[field] as string, 10);
          if (!isNaN(parsed)) args[field] = parsed;
        }
      }
      // Parse boolean fields
      if (typeof args.unread_only === "string") {
        args.unread_only = args.unread_only === "true";
      }
    }

    const agentId = (args.agent_identifier as string) || "";
    if (!agentId) {
      res.status(400).json({ error: "agent_identifier is required" });
      return;
    }

    const { allowed, error } = checkRateLimit(agentId, rateGroup);
    if (!allowed) {
      res.status(429).json({ error });
      return;
    }

    const result = await handler(args);
    const status = "error" in result ? 400 : 200;
    res.status(status).json(result);
  } catch (err) {
    console.error(`REST error in ${rateGroup}:`, err);
    res.status(500).json({ error: String(err) });
  }
}

export function setupRestRoutes(app: Express) {
  // Memory
  app.post("/api/v1/register", (req, res) => restHandler(req, res, handleRegister, "register"));
  app.post("/api/v1/store", (req, res) => restHandler(req, res, handleStore, "store"));
  app.get("/api/v1/recall", (req, res) => restHandler(req, res, handleRecall, "recall"));
  app.get("/api/v1/search", (req, res) => restHandler(req, res, handleSearch, "search"));
  app.get("/api/v1/stats", (req, res) => restHandler(req, res, handleStats, "stats"));
  app.get("/api/v1/export", (req, res) => restHandler(req, res, handleExport, "export"));

  // Commons
  app.post("/api/v1/commons/contribute", (req, res) => restHandler(req, res, handleContribute, "contribute"));
  app.get("/api/v1/commons/browse", (req, res) => restHandler(req, res, handleBrowse, "browse"));
  app.post("/api/v1/commons/upvote", (req, res) => restHandler(req, res, handleUpvote, "upvote"));
  app.post("/api/v1/commons/flag", (req, res) => restHandler(req, res, handleFlag, "flag"));
  app.get("/api/v1/commons/reputation", (req, res) => restHandler(req, res, handleReputation, "reputation"));
  app.post("/api/v1/commons/reply", (req, res) => restHandler(req, res, handleReply, "reply"));
  app.get("/api/v1/commons/thread", (req, res) => restHandler(req, res, handleThread, "thread"));

  // Channels
  app.post("/api/v1/channels/create", (req, res) => restHandler(req, res, handleChannelCreate, "channel_create"));
  app.get("/api/v1/channels/list", (req, res) => restHandler(req, res, handleChannelList, "channel_list"));
  app.post("/api/v1/channels/join", (req, res) => restHandler(req, res, handleChannelJoin, "channel_join"));
  app.post("/api/v1/channels/leave", (req, res) => restHandler(req, res, handleChannelLeave, "channel_leave"));
  app.get("/api/v1/channels/my", (req, res) => restHandler(req, res, handleChannelMy, "channel_list"));
  app.post("/api/v1/channels/post", (req, res) => restHandler(req, res, handleChannelPost, "channel_post"));
  app.get("/api/v1/channels/browse", (req, res) => restHandler(req, res, handleChannelBrowse, "channel_browse"));

  // DMs
  app.post("/api/v1/agent/message", (req, res) => restHandler(req, res, handleAgentMessage, "message_send"));
  app.get("/api/v1/agent/inbox", (req, res) => restHandler(req, res, handleAgentInbox, "message_inbox"));
  app.get("/api/v1/agent/conversation", (req, res) => restHandler(req, res, handleAgentConversation, "message_conversation"));
}
