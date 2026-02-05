You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Architecture & Patterns

### Tech Stack
- SvelteKit with Svelte 5 (runes: `$state`, `$derived`, `$effect`, `{#snippet}`)
- TanStack Query (`@tanstack/svelte-query`) for data fetching
- `@wagmi/core` (framework-agnostic, NOT the React wagmi) for Ethereum interaction
- DaisyUI + Tailwind for styling
- viem for ABI encoding, formatting, types

### Contract Reads
`src/lib/query/contractReads.svelte.ts` provides:
- **`createReadQuery(options)`** — generic contract read with polling support
  - `contract`: either a `ContractName` string (e.g. `"positionManager"`) or a `0x`-prefixed address (requires `abi` option)
  - `watch: true` polls every 5s, `watch: number` sets custom interval
- **`readVaultQuery(functionName, args)`** — pre-configured for CrossLiquidVault

### Contract Writes
`src/lib/query/contractWrites.svelte.ts` provides `useContractWrite()` — handles tx lifecycle (sent → confirmed), invalidates queries.

### Deployed Contracts
`src/lib/contracts/deployedContracts.ts` auto-processes `generated.local.ts` / `generated.prod.ts`.
ABI exports end in `Abi`, address exports end in `Address`.
`ContractName` type: `"positionManager" | "crossLiquidVault" | ...`
Helper: `createDeployedContractInfo(name, chainId)` → `{ address, abi }`.

### Chain Config
`src/lib/wagmi/chains.ts`:
- `vaultChain` = first chain (foundry local or Base production)
- `vaultChainId` = `vaultChain.id`
- Environment auto-detected: local (foundry:31337) vs production (Base + multi-chain)

### UI Components
- **`QueryRenderer`** (`src/lib/components/QueryRenderer.svelte`) — handles loading/error/success states for any TanStack query. Usage: `<QueryRenderer query={q}>{#snippet children(data)} ... {/snippet}</QueryRenderer>`
- **`Badge`** (`atoms/Badge.svelte`) — variants: `success`, `warning`, `error`, `info`, `primary`, `neutral`
- **`Alert`** (`atoms/Alert.svelte`) — variants: `info`, `success`, `warning`, `error`

### Formatting Utilities
`src/lib/utils/format.ts`:
- `formatETH(value, displayDecimals?)` — formats wei (18 decimals)
- `formatTokenAmount(value, decimals, displayDecimals)` — generic token formatter
- `formatAddress(address)` — `0x1234...5678`

### Price Utilities
`src/lib/types/exchangeRate.ts`:
- `convertSqrtPriceX96ToPrice(sqrtPriceX96)` — sqrtPriceX96 → human USD price (hardcoded 10^12 for ETH/USDC)

### Key Data: PositionManager `getAllPositionsWithPoolState` returns
```
[ids: bytes32[], positions: Position[], currentTicks: int24[], inRange: bool[]]
```
Each `Position` has:
```
{ poolManager, poolKey: { currency0, currency1, fee, tickSpacing, hooks },
  tickLower, tickUpper, liquidity, amount0, amount1, timestamp }
```
- `currency0 = 0x000...000` means native ETH (18 decimals)
- `currency1` is the ERC20 token address (e.g. USDC at 6 decimals)

### Uniswap v4 Tick ↔ Price
- `price = 1.0001^tick` (raw ratio of token1/token0)
- Human-readable: `price * 10^(decimals0 - decimals1)`
- For ETH/USDC: `1.0001^tick * 10^12` = USDC per ETH
