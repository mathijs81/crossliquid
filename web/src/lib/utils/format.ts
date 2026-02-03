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
