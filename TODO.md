## Next steps

- [x] simple vault contract
- [x] UI: deposit funds into vault
- [ ] Manager that can get funds from contract, deploy to uniswap
  - [x] First commit
  - [x] Actual deployment / getting from uniswap
- [x] UI: show current deployment in uniswap
- [x] Make everything proxies
- [ ] Working setup for simple uniswap v4 hook
  - [ ] Address mining works
  - [ ] Only allow our own liquidity
  - [ ] Adjusts fee based on external input
  - [ ] Fee adjustment based on TWAP or oracle?
- [x] Automate ABI json generation -> agent (copyAbis.sh)
- [ ] Working test of li.fi composer
- [x] offchain agent: collect data, determine liquidity scores
- [ ] offchain agent: route funds from base chain to other chains (in progress)
- [x] UI: show status across chains
- [x] Docker build and production deployment 

**Nice to have**

- [x] Autogenerate ABIs used in agent
- [ ] "scheduled" redeem. If you have more than 3% of the total earnings it's cumbersome to redeem small amounts at a time and wait for the 'brain' to replenish the liquid vault

## Later (to make more production ready)

- [ ] whitelist target chain swap calls? with timelock?
- [ ] set mint / redeem per time limits?
- [ ] pause minting / redeeming 
