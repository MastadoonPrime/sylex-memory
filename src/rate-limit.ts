// Sylex Memory — sliding-window rate limiter (in-memory)

const RATE_LIMITS: Record<string, [number, number]> = {
  // [max_calls, window_seconds]
  register: [5, 3600],
  store: [100, 60],
  recall: [200, 60],
  search: [120, 60],
  export: [5, 3600],
  stats: [60, 60],
  contribute: [20, 60],
  browse: [120, 60],
  upvote: [60, 60],
  flag: [20, 60],
  reputation: [60, 60],
  reply: [30, 60],
  thread: [120, 60],
  channel_create: [5, 3600],
  channel_join: [20, 60],
  channel_leave: [20, 60],
  channel_list: [120, 60],
  channel_post: [60, 60],
  channel_browse: [120, 60],
  message_send: [30, 60],
  message_inbox: [120, 60],
  message_conversation: [60, 60],
  default: [200, 60],
};

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  sessionId: string,
  toolGroup: string
): { allowed: boolean; error: string } {
  const id = sessionId || "anonymous";
  const [maxCalls, window] = RATE_LIMITS[toolGroup] ?? RATE_LIMITS.default;
  const key = `${id}:${toolGroup}`;
  const now = Date.now() / 1000; // epoch seconds

  if (!buckets.has(key)) {
    buckets.set(key, []);
  }
  const bucket = buckets.get(key)!;

  // Remove expired entries
  while (bucket.length > 0 && bucket[0] < now - window) {
    bucket.shift();
  }

  if (bucket.length >= maxCalls) {
    return {
      allowed: false,
      error: `Rate limit exceeded: max ${maxCalls} ${toolGroup} calls per ${window}s.`,
    };
  }

  bucket.push(now);

  // Periodic cleanup
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || v[v.length - 1] < now - 7200) {
        buckets.delete(k);
      }
    }
  }

  return { allowed: true, error: "" };
}
