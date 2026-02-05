import { logger } from "../logger.js";

export const validatePrivateKey = (
  key: string | undefined,
): `0x${string}` | undefined => {
  if (!key) {
    return undefined;
  }

  if (!key.startsWith("0x") || key.length !== 66) {
    logger.error(
      { keyLength: key.length, hasPrefix: key.startsWith("0x") },
      "Invalid private key format - must be 0x followed by 64 hex characters",
    );
    throw new Error("VAULT_PRIVATE_KEY is invalid");
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    logger.error("Private key contains invalid characters");
    throw new Error("VAULT_PRIVATE_KEY contains invalid hex characters");
  }

  return key as `0x${string}`;
};

export const validateAddress = (
  address: string | undefined,
): `0x${string}` | undefined => {
  if (!address) {
    return undefined;
  }

  if (!address.startsWith("0x") || address.length !== 42) {
    logger.error(
      { addressLength: address.length },
      "Invalid address format - must be 0x followed by 40 hex characters",
    );
    throw new Error("Invalid address format");
  }

  return address as `0x${string}`;
};
