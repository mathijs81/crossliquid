# CrossLiquid - Agentic Crosschain LP

## Goal

Multi-chain agentic liquidity management.

More later.

Forked off  [svelte-scaffold-eth: A modern starter template for building Ethereum dApps with SvelteKit 5, Foundry, and DaisyUI.](https://github.com/mathijs81/svelte-scaffold-eth)

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
