// Returns "0x1234...5678" format
export function formatAddress(address: string | undefined): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatBytes32StringHtml(
  byteString: `0x${string}` | null,
): string {
  if (!byteString) {
    return "<span class='font-mono'>(undefined)</span>";
  }

  // Just to be absolutely sure, escape characters to prevent injection attacks
  const escapedContent = byteString
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  if (byteString.length > 16) {
    return `<span class="font-mono" title="${escapedContent}">${escapedContent.slice(0, 16)}...</span>`;
  }
  return `<span class="font-mono" title="${escapedContent}">${escapedContent}</span>`;
}

export function formatTokenAmount(
  value: bigint | undefined | null,
  decimals: number = 18,
  displayDecimals: number = 4,
): string {
  if (value === undefined || value === null) return "—";

  const formatted = Number(value) / 10 ** decimals;
  return formatted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

export function formatETH(
  value: bigint | undefined | null,
  displayDecimals: number = 4,
): string {
  return formatTokenAmount(value, 18, displayDecimals);
}

export function formatPrice(
  value: bigint | undefined | null,
  decimals: number = 18,
  displayDecimals: number = 4,
): string {
  if (value === undefined || value === null) return "—";

  const formatted = Number(value) / 10 ** decimals;
  return formatted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

export function formatUSD(value: number, displayDecimals: number = 2): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: displayDecimals,
    maximumFractionDigits: displayDecimals,
  })}`;
}

// Uniswap v4: price = 1.0001^tick, adjusted for token decimal difference
export function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): number {
  return 1.0001 ** tick * 10 ** (decimals0 - decimals1);
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

interface TokenMeta {
  symbol: string;
  decimals: number;
}

const KNOWN_TOKENS: Record<string, TokenMeta> = {
  [ZERO_ADDRESS]: { symbol: "ETH", decimals: 18 },
};

export function registerToken(
  address: string,
  symbol: string,
  decimals: number,
): void {
  KNOWN_TOKENS[address.toLowerCase()] = { symbol, decimals };
}

export function getTokenMeta(address: string): TokenMeta {
  return KNOWN_TOKENS[address.toLowerCase()] ?? { symbol: "???", decimals: 18 };
}

// Uniswap v4 full-range detection: ticks at or beyond min/max usable
const TICK_FULL_RANGE_THRESHOLD = 880000;

export function isFullRange(tickLower: number, tickUpper: number): boolean {
  return (
    tickLower <= -TICK_FULL_RANGE_THRESHOLD &&
    tickUpper >= TICK_FULL_RANGE_THRESHOLD
  );
}
