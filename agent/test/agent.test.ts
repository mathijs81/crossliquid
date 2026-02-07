import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { agent } from "../src/agent.js";
import { ENVIRONMENT } from "../src/env.js";

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
  });

  it("should start and stop correctly", async () => {
    agent.start(200);
    expect(agent.getStats().status).toBe("running");

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const stats = agent.getStats();
    // Checking our test chain
    expect(Object.keys(stats.ethUsdcData).length).toBe(1);
    const data = Object.values(stats.ethUsdcData)[0];

    // TODO: this is pretty brittle, it got a lot lower because
    // we added a test swap to the setup script that moves the
    // pool price down.
    expect(data.swapSimulation.usdcOutput).toBeCloseTo(2089.868);
    //2131.833);

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

  it("should detect environment mode correctly", () => {
    expect(ENVIRONMENT).toMatch(/^(development|production|testnet)$/);
  });
});
