## Next steps

- [x] simple vault contract
- [x] UI: deposit funds into vault
- [x] Manager that can get funds from contract, deploy to uniswap
  - [x] First commit
  - [x] Actual deployment / getting from uniswap
- [x] UI: show current deployment in uniswap
- [x] Make everything proxies
- [x] Working setup for simple uniswap v4 hook
  - [x] Address mining works
  - [ ] Only allow our own liquidity --> deferred for now
  - [x] Adjusts fee based on external input
  - [ ] Fee adjustment based on TWAP or oracle? --> deferred for now
- [x] Automate ABI json generation -> agent (copyAbis.sh)
- [x] Working test of li.fi composer
- [x] offchain agent: collect data, determine liquidity scores
- [x] local test setup: add multicall3
- [ ] offchain agent: route funds from base chain to other chains (in progress)
- [x] UI: show status across chains
- [x] Docker build and production deployment 
- [x] UI: show feegrowth global
- [ ] liquidity opportunity: pull in more pools
- [x] Calculate final liquidity opportunity score
- [ ] Chain prices: make clearer what the interval is, make it longer (e.g. 4hr)
- [ ] agent automatically syncs, swaps & deploys

**Nice to have**

- [x] Autogenerate ABIs used in agent
- [ ] "scheduled" redeem. If you have more than 3% of the total earnings it's cumbersome to redeem small amounts at a time and wait for the 'brain' to replenish the liquid vault
- [ ] library project for shared code between agent and web (uniswap calculations, production uniswap addresses etc)

## Later (to make more production ready)

- [ ] whitelist target chain swap calls? with timelock?
- [ ] set mint / redeem per time limits?
- [ ] pause minting / redeeming 
- [ ] redeem in UI, keep couple of % of TVL in the vault
- [ ] do the conversion rate in the vault vs. a "liquidity unit" (e.g. $ sqrt(price) + 1/sqrt(price) ETH) instead of full ETH
- [ ] let the agent index the status on each chain and show in the dashboard for all chains what the positions are
