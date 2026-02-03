import Fastify from "fastify";
import { agent } from "./agent.js";
import { logger } from "./logger.js";

const fastify = Fastify({
  logger,
});

// Health check endpoint
fastify.get("/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Stats endpoint
fastify.get("/stats", async () => {
  return agent.getStats();
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

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");
  agent.stop();
  await fastify.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down gracefully...");
  agent.stop();
  await fastify.close();
  process.exit(0);
});

start();
