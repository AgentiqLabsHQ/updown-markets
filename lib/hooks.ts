"use client";

import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { writeContract, waitForTransactionReceipt } from "@wagmi/core";
import { CONTRACTS, ABI, CHAIN_ID, Side } from "./contracts";
import type { Battle } from "./format";

const POLL = 15000;

/** Detects when the connected wallet is on the wrong network and can switch it. */
export function useNetwork() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  return {
    wrongNetwork: isConnected && chainId !== undefined && chainId !== CHAIN_ID,
    switching: isPending,
    switchToRobinhood: () => switchChainAsync({ chainId: CHAIN_ID }),
  };
}

/** Latest battle id (battleCount). */
export function useBattleCount() {
  const q = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "battleCount",
    query: { refetchInterval: POLL },
  });
  return { id: q.data as bigint | undefined, refetch: q.refetch };
}

/** Full state for one battle id. */
export function useBattle(id?: bigint) {
  const enabled = id !== undefined && id > 0n;
  const battle = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "getBattle",
    args: enabled ? [id] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  const entries = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "entriesCount",
    args: enabled ? [id] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  const e = entries.data as [bigint, bigint] | undefined;
  return {
    battle: battle.data as Battle | undefined,
    entriesA: e?.[0],
    entriesB: e?.[1],
    refetch: () => {
      battle.refetch();
      entries.refetch();
    },
  };
}

/** Chainlink feed symbol, e.g. "AAPL/USD" -> "AAPL". */
export function useFeedSymbol(feed?: `0x${string}`) {
  const q = useReadContract({
    address: feed,
    abi: ABI.feed,
    functionName: "description",
    query: { enabled: !!feed && feed !== "0x0000000000000000000000000000000000000000" },
  });
  const desc = q.data as string | undefined;
  return desc ? desc.split("/")[0] : undefined;
}

/** UPDOWN balance, USDC balance, and entry capacity for a specific battle (capacity is battle-
 * scoped since each battle locks its own UPDOWN requirement at creation). Entering never
 * requires a token approval — there is no entry fee. */
export function useAccountState(address?: `0x${string}`, battleId?: bigint) {
  const enabled = !!address;
  const capEnabled = enabled && battleId !== undefined && battleId > 0n;
  const updown = useReadContract({
    address: CONTRACTS.updown,
    abi: ABI.updown,
    functionName: "balanceOf",
    args: enabled ? [address] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  const usdc = useReadContract({
    address: CONTRACTS.usdc,
    abi: ABI.usdc,
    functionName: "balanceOf",
    args: enabled ? [address] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  const capacity = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "capacityOfUser",
    args: capEnabled ? [battleId, address] : undefined,
    query: { enabled: capEnabled, refetchInterval: POLL },
  });
  return {
    updown: updown.data as bigint | undefined,
    usdc: usdc.data as bigint | undefined,
    capacity: capacity.data as bigint | undefined,
    refetch: () => {
      updown.refetch();
      usdc.refetch();
      capacity.refetch();
    },
  };
}

/** How many entries `address` already placed in a battle. */
export function useUserEntries(id?: bigint, address?: `0x${string}`) {
  const enabled = id !== undefined && id > 0n && !!address;
  const q = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "entriesOf",
    args: enabled ? [id, address] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  return q.data as bigint | undefined;
}

/** A wallet's aggregate claimable amount for a battle (covers every winning entry it holds). */
export function useClaimable(id?: bigint, address?: `0x${string}`) {
  const enabled = id !== undefined && id > 0n && !!address;
  const q = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "claimable",
    args: enabled ? [id, address] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  return { amount: q.data as bigint | undefined, refetch: q.refetch };
}

/** Whether `address` holds OPERATOR_ROLE (can create/lock/settle battles). */
export function useIsOperator(address?: `0x${string}`) {
  const role = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "OPERATOR_ROLE",
  });
  const has = useReadContract({
    address: CONTRACTS.battleManager,
    abi: ABI.battleManager,
    functionName: "hasRole",
    args: role.data && address ? [role.data as `0x${string}`, address] : undefined,
    query: { enabled: !!role.data && !!address },
  });
  return has.data as boolean | undefined;
}

export interface BattleConfigInput {
  feedA: `0x${string}`;
  feedB: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  openTime: bigint;
  lockTime: bigint;
  settleTime: bigint;
  winnerSlots: number;
  maxEntriesPerBattle: number;
  rewardToken: `0x${string}`;
}

/** Imperative write actions (sequential-friendly). */
export function useActions() {
  const config = useConfig();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  // Loosely typed on purpose: ABIs are imported as `Abi` (not const-asserted),
  // so wagmi's precise param inference isn't available here.
  async function send(params: Record<string, unknown>) {
    // Writes go through the wallet — make sure it's on Robinhood testnet first,
    // otherwise the tx is sent on whatever network the wallet happens to be on.
    if (chainId !== undefined && chainId !== CHAIN_ID) {
      await switchChainAsync({ chainId: CHAIN_ID });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await writeContract(config, { ...params, chainId: CHAIN_ID } as any);
    await waitForTransactionReceipt(config, { hash });
    return hash;
  }
  return {
    createBattle: (cfg: BattleConfigInput, pool: bigint) =>
      send({
        address: CONTRACTS.battleManager,
        abi: ABI.battleManager,
        functionName: "createBattle",
        args: [cfg, pool],
      }),
    lock: (id: bigint) =>
      send({ address: CONTRACTS.battleManager, abi: ABI.battleManager, functionName: "lock", args: [id] }),
    settle: (id: bigint, value: bigint = 0n) =>
      send({ address: CONTRACTS.battleManager, abi: ABI.battleManager, functionName: "settle", args: [id], value }),
    faucetUpdown: () =>
      send({ address: CONTRACTS.updown, abi: ABI.updown, functionName: "faucet" }),
    faucetUsdc: () =>
      send({ address: CONTRACTS.usdc, abi: ABI.usdc, functionName: "faucet" }),
    approveUsdc: (amount: bigint) =>
      send({
        address: CONTRACTS.usdc,
        abi: ABI.usdc,
        functionName: "approve",
        args: [CONTRACTS.rewardVault, amount],
      }),
    /** Approve any standard ERC-20 reward token for the vault (native ETH needs no approval). */
    approveToken: (token: `0x${string}`, amount: bigint) =>
      send({
        address: token,
        abi: ABI.usdc, // any standard ERC-20 ABI works to encode approve(address,uint256)
        functionName: "approve",
        args: [CONTRACTS.rewardVault, amount],
      }),
    enter: (id: bigint, side: Side) =>
      send({
        address: CONTRACTS.battleManager,
        abi: ABI.battleManager,
        functionName: "enter",
        args: [id, side],
      }),
    claim: (id: bigint) =>
      send({
        address: CONTRACTS.battleManager,
        abi: ABI.battleManager,
        functionName: "claim",
        args: [id],
      }),
    recoverUnclaimed: (id: bigint) =>
      send({
        address: CONTRACTS.battleManager,
        abi: ABI.battleManager,
        functionName: "recoverUnclaimed",
        args: [id],
      }),
    // Testnet-only: refresh a mock Chainlink feed so lock/settle prices are fresh.
    setFeedPrice: (feed: `0x${string}`, price: bigint) =>
      send({ address: feed, abi: ABI.feed, functionName: "setAnswer", args: [price] }),
  };
}
