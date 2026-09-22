import { ponder } from "ponder:registry";
import { battle, entry, claim } from "ponder:schema";

ponder.on("BattleManager:BattleCreated", async ({ event, context }) => {
  const { battleId, config, rewardPool } = event.args;
  await context.db.insert(battle).values({
    id: battleId,
    status: 1, // Open
    winningSide: 0,
    feedA: config.feedA,
    feedB: config.feedB,
    openTime: config.openTime,
    lockTime: config.lockTime,
    settleTime: config.settleTime,
    winnerSlots: config.winnerSlots,
    maxEntriesPerBattle: config.maxEntriesPerBattle,
    rewardToken: config.rewardToken,
    rewardPool,
    perSlotReward: 0n,
    winnerCount: 0,
    entriesA: 0,
    entriesB: 0,
    createdAt: event.block.timestamp,
  });
});

ponder.on("BattleManager:Entered", async ({ event, context }) => {
  const { battleId, user, side, entryIndex } = event.args;
  await context.db.insert(entry).values({
    id: `${battleId}-${side}-${entryIndex}`,
    battleId,
    user,
    side,
    entryIndex,
    txHash: event.transaction.hash,
    createdAt: event.block.timestamp,
  });
  await context.db
    .update(battle, { id: battleId })
    .set((row) => (side === 1 ? { entriesA: row.entriesA + 1 } : { entriesB: row.entriesB + 1 }));
});

ponder.on("BattleManager:Locked", async ({ event, context }) => {
  await context.db.update(battle, { id: event.args.battleId }).set({ status: 2 });
});

ponder.on("BattleManager:DiceRequested", async ({ event, context }) => {
  await context.db.update(battle, { id: event.args.battleId }).set({ status: 3 });
});

ponder.on("BattleManager:Settled", async ({ event, context }) => {
  const { battleId, winningSide, winnerCount, perSlotReward } = event.args;
  await context.db.update(battle, { id: battleId }).set({
    status: 4,
    winningSide: Number(winningSide),
    winnerCount: Number(winnerCount),
    perSlotReward,
    settledAt: event.block.timestamp,
  });
});

ponder.on("BattleManager:Drawn", async ({ event, context }) => {
  await context.db
    .update(battle, { id: event.args.battleId })
    .set({ status: 5, settledAt: event.block.timestamp });
});

ponder.on("BattleManager:Cancelled", async ({ event, context }) => {
  await context.db.update(battle, { id: event.args.battleId }).set({ status: 6 });
});

ponder.on("BattleManager:Claimed", async ({ event, context }) => {
  const { battleId, user, amount } = event.args;
  await context.db.insert(claim).values({
    id: `${battleId}-${user}`,
    battleId,
    user,
    amount,
    createdAt: event.block.timestamp,
  });
});

ponder.on("BattleManager:RewardRecovered", async ({ event, context }) => {
  await context.db
    .update(battle, { id: event.args.battleId })
    .set({ recoveredAt: event.block.timestamp });
});
