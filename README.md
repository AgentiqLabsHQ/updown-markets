# Updown Markets

A daily on-chain prediction competition built on **Robinhood Chain** (an Arbitrum L2). Each day a *battle* pairs two tokenized equities (e.g. AAPL vs. TSLA); players pick which one will have the higher percentage return over a fixed measurement window. Correct entries share a reward pool. When more correct entries qualify than there are reward slots, an auditable, verifiably-random **Dice** mechanic selects the winners.

Entering a battle requires no protocol fee. A player's **UPDOWN** token holdings only determine their entry *capacity* — the tokens stay in the user's wallet and are never deposited, staked, or transferred, and they do not influence the market outcome.

---

## How a battle works

| Phase | What happens |
|-------|--------------|
| **Open** | A battle publishes its token pair, measurement window, entry-capacity requirement, reward pool, and available slots. Entry is open from `openTime` until `lockTime`. |
| **Lock** | Entries close at the cutoff. The contract snapshots each token's opening price from its Chainlink feed (with L2 sequencer-uptime and staleness guards). |
| **Settle** | After the window closes, closing prices are read and percentage returns compared. The higher return wins. |
| **Claim** | Winning entries share the reward pool, one claim per wallet. If eligible winners exceed the reward slots, Dice picks the winners under a verifiable rule. |

Settlement prices come from Chainlink tokenized-equity feeds on Robinhood Chain. Randomness for oversubscribed battles uses **Pyth Entropy** (commit–reveal), since Chainlink VRF is not available on this chain.

---

## Repository layout

```
.
├── app/            Next.js (App Router) frontend — battle, dashboard, leaderboard,
│                   faucet, settings, and API routes (RPC proxy, leaderboard, catalog)
├── lib/            Shared client code — chain config, contract bindings, ABIs,
│                   asset registry, hooks, Supabase + wallet helpers
├── contracts/      Foundry workspace — BattleManager, RewardVault, DiceSelector,
│                   libraries, interfaces, mocks, deploy scripts, and tests
├── indexer/        Ponder indexer — serves battle/leaderboard data over GraphQL
├── scripts/        Keeper + daily-battle scheduler, market calendar, oracle helpers
├── supabase/       Database migrations for profiles and the stock-token catalog
├── docs/           Build plan and project documentation
└── public/         Static assets
```

## Tech stack

- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, Framer Motion, Three.js
- **Wallet / auth:** Privy + wagmi + viem
- **Smart contracts:** Solidity, Foundry (Chainlink price feeds, Pyth Entropy)
- **Indexer:** Ponder (GraphQL over on-chain events)
- **Data:** Supabase (profiles and settings)
- **Chain:** Robinhood Chain testnet (chain id `46630`) / mainnet (chain id `4663`)

---

## Getting started

### Prerequisites

- Node.js 20+
- [Foundry](https://book.getfoundry.sh/) (for the contracts workspace)
- A Supabase project and a [Privy](https://privy.io) app id (for full functionality)

### 1. Install and configure

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app id (wallet auth) |
| `NEXT_PUBLIC_RH_TESTNET_RPC` | Browser RPC — use `/api/rpc` (the same-origin proxy) |
| `RH_TESTNET_RPC_UPSTREAM` | Server-only upstream RPC the proxy forwards to |
| `NEXT_PUBLIC_INDEXER_URL` | Ponder GraphQL endpoint (optional; falls back to chain reads) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |

### 2. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Other scripts:

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

---

## Smart contracts

The Foundry workspace lives in [`contracts/`](contracts/). See [`contracts/README.md`](contracts/README.md) for the full architecture and lifecycle notes.

```bash
cd contracts
forge build
forge test -vv
```

Deploy to testnet (mock-backed and self-contained):

```bash
cp .env.example .env    # set RH_TESTNET_RPC + PRIVATE_KEY (testnet only)
forge script script/Deploy.s.sol --rpc-url rh_testnet --broadcast
```

Deployed addresses are recorded in [`contracts/deployments/`](contracts/deployments/).

---

## Indexer

The [`indexer/`](indexer/) Ponder app indexes `BattleManager` events and serves them over GraphQL, powering the leaderboard and battle history. The frontend falls back to direct chain reads when the indexer is unavailable.

```bash
cd indexer
npm install
npm run dev     # ponder dev
```

---

## Keeper

The keeper ([`scripts/keeper.mjs`](scripts/keeper.mjs)) creates each day's battle on the real US equity trading calendar and locks/settles battles as they come due. It is idempotent — create-if-needed, lock/settle-if-due, no-op otherwise — so overlapping or repeated runs are harmless.

```bash
node scripts/keeper.mjs          # full cycle: create-if-needed + lock/settle due
node scripts/keeper.mjs create   # create today's battle only
node scripts/keeper.mjs run      # lock/settle due battles only
```

It runs on a schedule in the cloud via [`.github/workflows/keeper.yml`](.github/workflows/keeper.yml) (every 5 minutes), so it does not depend on any local machine. The operator credential is supplied through environment/CI secrets (`PRIVATE_KEY` or `MNEMONIC`) and is never committed. For local scheduling, [`scripts/run-keeper.sh`](scripts/run-keeper.sh) sources the key from a git-ignored file or the macOS Keychain.

---

## Deployment

The frontend deploys to [Vercel](https://vercel.com). Backend concerns (contracts, indexer, keeper, migrations) are excluded from the frontend build via `.vercelignore` and are operated independently.

---

## Disclaimer

Updown Markets is experimental software running on a testnet. Participation may be restricted by jurisdiction, age, or launch status. Outcomes and rewards are not guaranteed. Nothing here is investment advice, brokerage, or a promise of returns. Review the applicable terms before entering a battle.
