import Fastify from "fastify";
import { agent } from "./agent";
import { logger } from "./logger";

const envToLogger = {
  development: {
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
  production: true,
  test: false,
};

const environment = process.env.NODE_ENV || "development";

const fastify = Fastify({
  logger: envToLogger[environment as keyof typeof envToLogger] ?? true,
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
