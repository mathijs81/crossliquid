# CrossLiquid - Agentic Crosschain LP

## Goal

Manage liquidity from a single vault cross-chain to find the best opportunities to generate LP fees while protecting against loss-versus-rebalancing and just-in-time liquidity sniping.

This prototype focuses on finding the best chains to provide USDC-ETH liquidity.

## How it works

Users deposit their funds to the CrossLiquid vault on Base.

We have an off-chain agent that determines where to redistribute the funds across Base, Optimism, Unichain, Mainnet

## Components

### 1. On-chain Vault

A simple contract on Base that accepts donations and hands out `$CLQ` tokens. Basic mechanism to allow gradual withdrawals (e.g. keep ~5% of funds always available on Base, when depleted, the agent will repatriate funds back from the LP positions into the vault).

### 2. On-chain Uniswap pools with hooks

- Guard against toxic flow (compare against oracle price)

- Adjust fees to current market conditions to extract more fees in volatile conditions

- Only our liquidity is counted in the pool, no just-in-time fee sniping

- Fires events to see what's going on

### 3. Off-chain agent

- Monitor the pools on various chains, keep a "liquidity opportunity score" for each chain

- Distribute vault funds between the various chain LPs

- Uses LI.FI composer to execute changes

### 4. Frontend

- Svelte-based UI to deposit funds

- Show current overview of pool distribution, Liquidity Opportunity Score per chain

### 5. (stretch:) Simulator

- Simulate historic trading patterns and how our setup would have (out?)performed vs naive singlechain LP.

## Out of scope for this hackathon

These things would be great to have, but to keep this project feasible for ~1 week of hacking, we choose to not focus on them now:

- More pairs than just ETH-USDC

- Increasing yield by storing idle funds into lending protocols

## Implementation details (work-in-progress)

- Liquidity Opportunity Score (LOS):
  - Probably using variables:
    - historic yield (+)
    - deviation from the oracle price (+/-, depending on which asset we want to send)
    - latency getting funds to the chain (-)
    - gas fees of the chain (-)
- Hook:
  - Before swap:
    - How to determine dynamic swap fee? How can we be friendly to aggregators so they won't skip our pool?
  - What events to fire for best communication for the offchain agent?
  - Access gating (probably automatic in the connection to Li.fi?)
- Offchain agent:
  - How do LOS scores translate to actual actions? (don't waste lots of gas on small adjustments)
  - How to keep track of in-progress actions, prevent double-sending adjustments?
  - Base logic, loop of:
    1. Collect information from all pools & vault and calculate LOS for each chain
    2. Determine 'ideal' distribution and necessary actions
    3. Send actions to li.fi composer (compensating for in-flight actions)

## Other open questions

- Li.fi composer doesn't support direct Uniswap LP'ing, how do I get the funds into the pool?
  - **Answer:** The PositionManager contract manages liquidity directly. The agent uses PositionManager to add/remove liquidity, and li.fi is only used for bridging funds between chains.
- Historic yield: how do we get this without building a historical yield database?

## Position Management

The agent now includes services and CLI tools for managing Uniswap V4 positions:

### Services

- **positionManager.ts** - Add/remove liquidity via PositionManager contract
- **swap.ts** - Swap ETH ↔ USDC to balance positions before adding liquidity
- **pool.ts** - Query pool state (tick, price, liquidity)

### CLI Tool

Manually manage positions without running the full agent loop:

```bash
cd agent

# List all positions
pnpm cli list-positions

# Add liquidity (0.5 ETH + 1000 USDC)
pnpm cli add-liquidity --eth 0.5 --usdc 1000

# Remove liquidity
pnpm cli remove-liquidity --position-id 0 --amount 100
```

Required environment variables (see `.env.example`):
- `POSITION_MANAGER_ADDRESS` - PositionManager contract address
- `POOL_MANAGER_ADDRESS` - Uniswap V4 PoolManager address
- `USDC_ADDRESS` - USDC token address
- `OPERATOR_PRIVATE_KEY` - Private key for transactions
- `CHAIN_ID` - Chain to operate on (31337 for local)

### Swapping for Balanced Positions

Since Uniswap V4 requires both tokens in the correct ratio:
- If you only have ETH, swap ~50% to USDC before adding liquidity
- If you only have USDC, swap ~50% to ETH
- The swap service handles this automatically based on the current pool price and tick range

See `IMPLEMENTATION_SUMMARY.md` for detailed integration guide.

## Relevant links

- [Composer (Composer & on-chain flow composition) - LI.FI](https://docs.li.fi/introduction/user-flows-and-examples/lifi-composer#key-benefits-of-li-fi-composer)



Forked off [svelte-scaffold-eth: A modern starter template for building Ethereum dApps with SvelteKit 5, Foundry, and DaisyUI.](https://github.com/mathijs81/svelte-scaffold-eth)

## Quick Start

```bash
# Install Foundry (using mise - recommended)
mise install

# Set up foundry/lib/forge-std submodule
git submodule update --init --recursive

# Install dependencies for both foundry and web
pnpm install

# Start local Foundry node (in terminal 1)
pnpm chain

# Deploy contracts + generate `web/src/lib/contracts/deployedContracts.ts` (in terminal 2)
pnpm deploy:anvil

# Start the web dev server (in terminal 3)
pnpm dev

# Open http://localhost:5173
```

Your app is now running with:

- Local Foundry node on `http://localhost:8545`
- Contracts deployed via Foundry scripts (see `foundry/broadcast/`)
- Generated contract deployment/ABI map at `web/src/lib/contracts/deployedContracts.ts`

## Development Workflow

The typical development cycle:

```bash
pnpm chain            # Start local Anvil node
pnpm deploy:anvil     # Deploy contracts & generate types
pnpm dev              # Start the frontend dev server
```

Run tests and checks (as executed in CI):

```bash
pnpm test:contracts   # Run Foundry tests
pnpm test:web         # Run frontend tests (unit + E2E)
pnpm check            # Type-check all code
pnpm lint             # Lint frontend code
```

See `package.json` for the full list of available commands including deployment to testnets, coverage reports, and more.

## License

MIT

## Acknowledgments

[HackMoney 2026 hackathon](https://ethglobal.com/events/hackmoney2026) for which this project is a submission

**AI tools/agents**

- **Gemini** explained inner workings of Uniswapv4 to me and helped me brainstorm and sharpen the idea of this hack

- **Claude Code** helped with implementing big parts of the frontend and Univ4 hook.

**Dev projects**

- [svelte-scaffold-eth](https://github.com/mathijs81/svelte-scaffold-eth)
- [scaffold-eth-2](https://github.com/scaffold-eth/scaffold-eth-2) - The original inspiration for svelte-scaffold-eth
- [@wagmi/core](https://wagmi.sh/core) - Framework-agnostic Ethereum library
- [viem](https://viem.sh) - TypeScript library for Ethereum
- [Foundry](https://getfoundry.sh) - Fast, portable, and modular toolkit for Ethereum
- [SvelteKit](https://kit.svelte.dev) - The fastest way to build web applications
- [DaisyUI](https://daisyui.com) - Beautiful, themeable UI components
