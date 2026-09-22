"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfig } from "wagmi";
import { readContract } from "@wagmi/core";
import type { Abi } from "viem";
import { CONTRACTS, ABI, Side, Status } from "./contracts";
import type { Battle } from "./format";

/** One row per battle the wallet participated in — claiming is per-wallet-per-battle now
 * (an aggregate covering every winning entry that wallet holds), not per-entry. */
export interface Position {
  battleId: bigint;
  side: number;
  entryCount: bigint;
  status: number;
  winningSide: number;
  rewardToken: `0x${string}`;
  claimableAmount: bigint;
  isWinner: boolean;
  alreadyClaimed: boolean;
  feedA: `0x${string}`;
  feedB: `0x${string}`;
}

const MAX_BATTLES = 12; // scan the most recent N battles

/** Loads the connected user's positions across recent battles, with aggregate claim status. */
export function useMyPositions(address?: `0x${string}`) {
  const config = useConfig();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!address) {
      setPositions([]);
      return;
    }
    let cancelled = false;
    const bm = { address: CONTRACTS.battleManager, abi: ABI.battleManager } as const;

    (async () => {
      setLoading(true);
      try {
        const count = (await readContract(config, { ...bm, functionName: "battleCount" })) as bigint;
        const found: Position[] = [];
        const from = count > BigInt(MAX_BATTLES) ? count - BigInt(MAX_BATTLES) + 1n : 1n;

        for (let id = count; id >= from && id >= 1n; id--) {
          const entryCount = (await readContract(config, { ...bm, functionName: "entriesOf", args: [id, address] })) as bigint;
          if (entryCount === 0n) continue;

          const b = (await readContract(config, { ...bm, functionName: "getBattle", args: [id] })) as Battle;
          const [ca] = (await readContract(config, { ...bm, functionName: "entriesCount", args: [id] })) as [bigint, bigint];

          // Determine which side this wallet backed by checking side A first (a wallet can only
          // hold entries on one side per battle).
          let side = Side.B;
          for (let i = 0n; i < ca; i++) {
            const who = (await readContract(config, { ...bm, functionName: "entryAt", args: [id, Side.A, i] })) as string;
            if (who.toLowerCase() === address.toLowerCase()) {
              side = Side.A;
              break;
            }
          }

          const claimableAmount = (await readContract(config, { ...bm, functionName: "claimable", args: [id, address] })) as bigint;
          const settled = b.status === Status.Settled;
          const onWinningSide = settled && b.winningSide === side;
          const isWinner = onWinningSide && (claimableAmount > 0n || (await _wasEverAWinner(config, bm, id, side, address)));
          const alreadyClaimed = isWinner && claimableAmount === 0n;

          found.push({
            battleId: id,
            side,
            entryCount,
            status: b.status,
            winningSide: b.winningSide,
            rewardToken: b.rewardToken,
            claimableAmount,
            isWinner,
            alreadyClaimed,
            feedA: b.feedA,
            feedB: b.feedB,
          });
        }
        if (!cancelled) setPositions(found);
      } catch {
        if (!cancelled) setPositions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, config, tick]);

  return { positions, loading, refresh };
}

/** Distinguishes "won and already claimed" from "lost" when claimableAmount reads 0 — checks
 * whether any of the wallet's entries on the winning side were ever selected as a winner. */
async function _wasEverAWinner(
  config: ReturnType<typeof useConfig>,
  bm: { address: `0x${string}`; abi: Abi },
  id: bigint,
  side: number,
  address: `0x${string}`,
): Promise<boolean> {
  const allWin = (await readContract(config, { ...bm, functionName: "allWin", args: [id] })) as boolean;
  if (allWin) return true;
  const [ca, cb] = (await readContract(config, { ...bm, functionName: "entriesCount", args: [id] })) as [bigint, bigint];
  const total = side === Side.A ? ca : cb;
  for (let i = 0n; i < total; i++) {
    const who = (await readContract(config, { ...bm, functionName: "entryAt", args: [id, side, i] })) as string;
    if (who.toLowerCase() !== address.toLowerCase()) continue;
    const won = (await readContract(config, { ...bm, functionName: "diceWinner", args: [id, i] })) as boolean;
    if (won) return true;
  }
  return false;
}
