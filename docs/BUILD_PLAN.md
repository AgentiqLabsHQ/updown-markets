# UpdownMarkets — Full App Build Plan (Phase 2)

Target: a working testnet application on Robinhood Chain (46630), wired to the live contracts
already deployed (`contracts/deployments/46630.json`).

## Monorepo layout (in this repo)
```
app/                 Next.js frontend (existing routes: /, /battle, /dashboard, /how-it-works, ...)
lib/                 web3 config, ABIs, contract hooks, indexer client
contracts/           Foundry (DONE — deployed to 46630)
indexer/             Ponder indexer → GraphQL API for history/dashboard
supabase/            profiles schema (optional, light)
scripts/             keeper (lock/settle automation)
```

## Deployed testnet addresses (source of truth)
- BattleManager `0x9737e6A983668D6AD677e72806c5cF53031cD639`
- RewardVault `0x6e37D9647A2A4D3cC13f9265C256C42055A16d65`
- DiceSelector `0x863bBD8399C6243d790151B2cFfE723DDae7641D`
- UPDOWN(mock) `0x0a7A8471f55440dD631f10B6EC8715E714Aa0441`
- USDC(mock) `0xFe271Ea5da6598121c637aC86242B5c3b73040c1`
- Oracle `0x13169f5ed412224965458CD02e7ab211F575F62a`, FeedA `0x509F…9CD9`, FeedB `0xe8A2…E6Ce`, Entropy `0xA395…FDc0`

## Work items
### 1. Frontend web3 foundation
- [ ] Add deps: `@privy-io/react-auth`, `wagmi`, `viem`, `@tanstack/react-query`, `graphql-request`
- [ ] `lib/chain.ts` — Robinhood testnet (46630) viem chain + RPC
- [ ] `lib/contracts.ts` — addresses + minimal ABIs (BattleManager, RewardVault, ERC20, DiceSelector)
- [ ] `app/providers.tsx` — Privy (app id) + wagmi + react-query providers; wrap in `layout.tsx`
- [ ] Connect-wallet button in the app shell/nav

### 2. Faucet (testnet onboarding)
- [ ] `/faucet` page — mint UPDOWN + USDC, show balances (so anyone can try a battle)

### 3. Battle page (`/battle`) — the core
- [ ] Read live battle via `getBattle`, `entriesCount`, `capacityOfUser`, token balances
- [ ] Show pair (A/TSLA vs B/AAPL from feed `description()`), pool, slots, window countdown, status
- [ ] Pick side → show your capacity + used entries
- [ ] Approve USDC (if needed) → `enter(battleId, side)` tx with toast + refetch
- [ ] Live entries (A vs B), your entries highlighted

### 4. Dashboard (`/dashboard`)
- [ ] "My entries" across battles (from indexer)
- [ ] Battle status + result; **Claim** button for winning entries → `claim(battleId, entryIndex)`
- [ ] Winnings summary

### 5. Indexer (Ponder)
- [ ] `indexer/ponder.config.ts` — chain 46630, BattleManager, start block
- [ ] `indexer/ponder.schema.ts` — Battle, Entry, Claim, User
- [ ] `indexer/src/index.ts` — handlers: BattleCreated, Entered, Locked, Settled, DiceFinalized, Claimed, Cancelled
- [ ] GraphQL at :42069; frontend `lib/indexer.ts` client

### 6. Keeper (automation)
- [ ] `scripts/keeper.ts` — find battles past lockTime/settleTime → `lock`/`settle` (viem walletClient)

### 7. Config, run, verify
- [ ] `.env.example` (frontend + indexer): RPC, Privy app id, contract addresses, indexer URL
- [ ] `npm install`, run indexer + `next dev`, verify against live battle #1 and a fresh battle
- [ ] README: run instructions + deploy notes (Vercel for web, Railway/Render for indexer)

## Design system (match landing page)
Dark `#101315` bg, accent `#c7e85b`, surfaces `#171c1e`/`#2a3235`, mono labels, `#aab4af` muted text.

## Out of scope for this pass (flagged)
- Mainnet swap-in of real UPDOWN/USDC/Chainlink/Pyth addresses + Safe admin
- Audit, legal, production hosting/CI
- Live Pyth Entropy reveal (keeper-driven) — mock reveal used on testnet
