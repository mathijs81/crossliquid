import Fastify from "fastify";
import { agent } from "./agent.js";
import { logger } from "./logger.js";
import { db } from "./services/database.js";
import { ENVIRONMENT } from "./env.js";
import { initializeTaskDatabase } from "./services/taskStore.js";

const fastify = Fastify({
  loggerInstance: logger,
});

// Initialize task database for /tasks endpoint (same store as CLI list-tasks)
const taskStore = initializeTaskDatabase();

// Health check endpoint
fastify.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Stats endpoint
fastify.get("/stats", async () => {
  return agent.getStats();
});

// Exchange rates endpoint
fastify.get("/rates", async (request) => {
  const { chainId, limit } = request.query as {
    chainId?: string;
    limit?: string;
  };
  const parsedChainId = chainId ? Number.parseInt(chainId, 10) : undefined;
  const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;

  return db.getRecentRates(parsedChainId, parsedLimit);
});

fastify.get("/pool-prices", async (request) => {
  const { limit } = request.query as {
    limit?: string;
  };
  const parsedLimit = limit ? Number.parseInt(limit, 10) : 256;
  return db.getRecentPoolPrices(parsedLimit);
});

// Agent actions/tasks (same data as CLI list-tasks)
fastify.get("/tasks", async (request) => {
  const { limit } = request.query as { limit?: string };
  const parsedLimit = limit ? Number.parseInt(limit, 10) : 50;
  const tasks = await taskStore.getRecentTasks(parsedLimit);
  return tasks;
});
// actions may have bigints, so add prehook to change them:

fastify.setReplySerializer((payload, statusCode) => {
  return JSON.stringify(payload, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
});


// Comprehensive metrics endpoint - combines metrics, LOS, and pool prices
fastify.get("/metrics", async (request) => {
  const { limit, chainId } = request.query as {
    limit?: string;
    chainId?: string;
  };
  const parsedLimit = limit ? Number.parseInt(limit, 10) : 256;
  const parsedChainId = chainId ? Number.parseInt(chainId, 10) : undefined;

  // Import here to avoid circular dependencies
  const { MetricsService } = await import("./services/metrics.js");
  const { calculateLOS } = await import("./services/los.js");
  const { chains } = await import("./config.js");

  // Get pool prices
  const poolPrices = db.getRecentPoolPrices(parsedLimit);

  // Calculate metrics for all chains or specific chain
  const chainIds = parsedChainId ? [parsedChainId] : Array.from(chains.keys());
  const metricsMap = await MetricsService.calculateMetricsForAllChains(chainIds);

  // Calculate LOS scores
  const losMap = await calculateLOS();

  // Combine into response
  const chainMetrics = Array.from(metricsMap.entries()).map(([chainId, metrics]) => {
    const los = losMap.get(chainId);
    return {
      chainId,
      chainName: chains.get(chainId)?.chainName || "Unknown",
      metrics,
      los: los || null,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    chains: chainMetrics,
    poolPrices: parsedChainId ? poolPrices.filter((p) => p.chainId === parsedChainId) : poolPrices,
  };
});

// Start server
const start = async () => {
  try {
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    logger.info({ port, host }, "Agent server listening");

    // Start the agent loop
    agent.start(30_000, ENVIRONMENT === "production" ? 5 * 60 * 1000 : 10_000);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  logger.info("Shutting down gracefully...");
  agent.stop();
  await fastify.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
