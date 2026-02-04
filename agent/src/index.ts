import Fastify from "fastify";
import { agent } from "./agent";
import { logger } from "./logger";
import { db } from "./services/database";

const fastify = Fastify({
  loggerInstance: logger,
});

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

// Start server
const start = async () => {
  try {
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    const host = process.env.HOST || "0.0.0.0";

    await fastify.listen({ port, host });
    logger.info({ port, host }, "Agent server listening");

    // Start the agent loop
    agent.start();
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
