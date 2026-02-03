import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { agent } from "../src/agent.js";

describe("Agent", () => {
  beforeEach(() => {
    agent.stop();
  });

  afterEach(() => {
    agent.stop();
  });

  it("should have initial stats with stopped status", () => {
    const stats = agent.getStats();
    expect(stats.status).toBe("stopped");
    expect(stats.lastUpdate).toBeNull();
    expect(Object.keys(stats.chainStats).length).toBeGreaterThan(0);
  });

  it("should start and stop correctly", () => {
    agent.start(100);
    expect(agent.getStats().status).toBe("running");

    agent.stop();
    expect(agent.getStats().status).toBe("stopped");
  });

  it("should not start multiple times", () => {
    agent.start(100);
    const initialInterval = (
      agent as unknown as { intervalId: NodeJS.Timeout | null }
    ).intervalId;

    agent.start(100);
    const secondInterval = (
      agent as unknown as { intervalId: NodeJS.Timeout | null }
    ).intervalId;

    expect(initialInterval).toBe(secondInterval);
    agent.stop();
  });

  it("should have chain stats for expected chains", () => {
    const stats = agent.getStats();
    const chainIds = Object.values(stats.chainStats).map(
      (stat) => stat.chainId,
    );

    // Should have stats for Base, Optimism, and Mainnet
    expect(chainIds).toContain(8453); // Base
    expect(chainIds).toContain(10); // Optimism
    expect(chainIds).toContain(1); // Mainnet
  });
});
