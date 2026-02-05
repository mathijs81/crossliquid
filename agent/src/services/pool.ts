import { chains } from "../config.js";
import { logger } from "../logger.js";
import { stateViewAbi } from "../abi/StateView.js";

export const getPoolCurrentTick = async (
  chainId: number,
  stateViewAddress: `0x${string}`,
  poolId: `0x${string}`,
): Promise<number | null> => {
  const config = chains.get(chainId);
  if (!config) {
    return null;
  }

  try {
    const client = config.publicClient;

    const slot0 = await client.readContract({
      address: stateViewAddress,
      abi: stateViewAbi,
      functionName: "getSlot0",
      args: [poolId],
    });

    return Number(slot0[1]);
  } catch (error) {
    logger.error(
      {
        chainId,
        stateViewAddress,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to fetch current tick",
    );
    return null;
  }
};
