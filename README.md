# CrossLiquid - Agentic Crosschain LP

**[Live Demo](https://crossliquid.duckdns.org/)** | HackMoney 2026 Submission

![CrossLiquid screenshot](./screenshot.png)

# Goal

CrossLiquid is agent-managed ETH-USDC Uniswap v4 liquidity across multiple chains. It finds the best opportunities for you to earn fees while protecting against loss-versus-rebalancing and just-in-time liquidity sniping.

## Current state

Users can deposit ETH into a vault on Base, an off-chain agent scores liquidity opportunities per chain, and will swap with li.fi between ETH and USDC to be able to deploy liquidity into ETH-USDC Uniswap v4 pools. It also uses li.fi to move funds between chains.

The uniswap v4 pools are using a custom hook that allows the agent to dynamically adjust fees based on volatility. The deployment of liquidity from the vault into uniswap is fully automated, including rebalancing to keep the position in the optimal tick range.

The cross-chain automated rebalance loop is still in progress, it is working via manual CLI commands.

The data collection that the agent would use to adjust liquidity across the different chains is present and visible on the frontend.

### Chains

CrossLiquid runs locally on a foundry node, and because li.fi is not possible to test locally I deployed it on both Base and Unichain for demo use.

## Components

### 1. On-chain Vault (`CrossLiquidVault.sol`)

A vault on Base that accepts deposits and mints `$CLQ` tokens. The intent is to keep a small liquid buffer on Base and repatriate from LP positions as needed.

### 2. Position manager (`PositionManager.sol`)

Owns the Uniswap v4 positions on each chain, exposes position/fee-growth lenses. It has a "operator" address that can execute calls as the manager to do swaps, add/remove liquidity and bridge funds to/from manager contracts on other chains.

### 3. Uniswap v4 hook (`VolatilityFeeHook.sol`)

CrossLiquid deposits into Uniswap v4 pools with this custom hook. It allows the offchain agent to adjust fees based on volatility.

### 4. Off-chain agent (`agent/`)

- Monitors pools across chains and computes a Liquidity Opportunity Score (LOS)
- Executes swaps via Li.FI and prepares per-chain LP actions
- Tracks in-flight actions to avoid double-adjusting

### 5. Frontend (`web/`)

Svelte UI to view liquidity opportunity scores, track the status of the LP positions and deposit funds into the vault.

## Liquidity Opportunity Score (LOS)

The Liquidity Opportunity Score (LOS) that the agent uses to score chains against each other is calculated based on the following variables:
- Historic yield (on each chain, we track the hook-free 0.05% ETH/USDC univ4 pool and measure its fee growth). Higher yield is better.
- Historic volatility. Higher volatility is better (but from the data it looks like the prices on all chains are perfectly correlated, so this variable is rarely very different between chains).
- Gas fees. Higher gas fees are worse.


## Deferred / future work

- hook: Make hook prevent other liquidity from being added to the pool (anti-JIT sniping)
- hook: Include other on-chain price data to instantly react to big price swings with higher fees
- vault: Redeem in the UI and make sure that there's always some liquid ETH in the vault
- agent: Finish fully automated cross-chain rebalancing loop
- Expand to more pairs beyond USDC-ETH
- Move idle funds into lending protocols for extra yield
- Simulator for tweaking how to do rebalancing, tick width, etc. to maximize yield while mitigating impermanent loss

This project was forked off [svelte-scaffold-eth: A modern starter template for building Ethereum dApps with SvelteKit 5, Foundry, and DaisyUI.](https://github.com/mathijs81/svelte-scaffold-eth)

## Quick Start

```bash
# Install Foundry (using mise - recommended)
mise install

# Set up foundry/lib/forge-std submodule
git submodule update --init --recursive

# Install dependencies for both foundry and web
pnpm install

# Start local Foundry node (in terminal 1) and deploy contracts
just run-chain

# Start the agent (terminal 2)
cd agent; pnpm dev

# Start the web dev server (in terminal 3)
cd web; pnpm dev

# Open http://localhost:5173
```

Your app is now running with:

- Local Foundry node on `http://localhost:8545`
- CrossLiquid contracts (Vault, PositionManager, VolatilityFeeHook) deployed
- Uniswap v4 infrastructure (PoolManager, USDC, WETH, initialized pool)
- Agent running locally
- Web frontend running locally



## License

MIT

## Acknowledgments

[HackMoney 2026 hackathon](https://ethglobal.com/events/hackmoney2026) for which this project is a submission

**AI tools/agents**

- **Gemini** explained inner workings of Uniswapv4 to me and helped me brainstorm and sharpen the idea of this hack

- **Claude Code** helped with implementing big parts of the frontend, local deployment of Uniswap and Univ4 hook.

- **OpenCode** for mostly UI tweaks

**Dev projects**

- [svelte-scaffold-eth](https://github.com/mathijs81/svelte-scaffold-eth)
- [scaffold-eth-2](https://github.com/scaffold-eth/scaffold-eth-2) - The original inspiration for svelte-scaffold-eth
- [OpenZeppelin SDK](https://github.com/OpenZeppelin/) for smart contract development
- [@wagmi/core](https://wagmi.sh/core) - Framework-agnostic Ethereum library
- [viem](https://viem.sh) - TypeScript library for Ethereum
- [Foundry](https://getfoundry.sh) - Fast, portable, and modular toolkit for Ethereum
- [SvelteKit](https://kit.svelte.dev) - The fastest way to build web applications
- [DaisyUI](https://daisyui.com) - Beautiful, themeable UI components
