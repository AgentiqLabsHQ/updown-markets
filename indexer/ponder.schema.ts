import { onchainTable, index } from "ponder";

/** One row per battle (summary; live status also readable on-chain). */
export const battle = onchainTable("battle", (t) => ({
  id: t.bigint().primaryKey(), // battleId
  status: t.integer().notNull(), // 1 Open 2 Locked 3 AwaitingDice 4 Settled 5 Drawn 6 Cancelled
  winningSide: t.integer().notNull().default(0),
  feedA: t.hex(),
  feedB: t.hex(),
  openTime: t.bigint(),
  lockTime: t.bigint(),
  settleTime: t.bigint(),
  winnerSlots: t.integer(),
  maxEntriesPerBattle: t.integer(),
  rewardToken: t.hex(),
  rewardPool: t.bigint(),
  perSlotReward: t.bigint().default(0n),
  winnerCount: t.integer().default(0),
  entriesA: t.integer().notNull().default(0),
  entriesB: t.integer().notNull().default(0),
  createdAt: t.bigint(),
  settledAt: t.bigint(),
  recoveredAt: t.bigint(),
}));

/** One row per entry (the unit of winner selection). */
export const entry = onchainTable(
  "entry",
  (t) => ({
    id: t.text().primaryKey(), // `${battleId}-${side}-${entryIndex}`
    battleId: t.bigint().notNull(),
    user: t.hex().notNull(),
    side: t.integer().notNull(), // 1 = A, 2 = B
    entryIndex: t.bigint().notNull(),
    txHash: t.hex(),
    createdAt: t.bigint(),
  }),
  (table) => ({
    byUser: index().on(table.user),
    byBattle: index().on(table.battleId),
  }),
);

/** Claim history — one row per wallet's aggregate claim on a battle. */
export const claim = onchainTable(
  "claim",
  (t) => ({
    id: t.text().primaryKey(), // `${battleId}-${user}`
    battleId: t.bigint().notNull(),
    user: t.hex().notNull(),
    amount: t.bigint().notNull(),
    createdAt: t.bigint(),
  }),
  (table) => ({ byUser: index().on(table.user) }),
);
