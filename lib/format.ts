import { formatUnits } from "viem";
import { Status, Side, USDC_DECIMALS, UPDOWN_DECIMALS } from "./contracts";

/** Shape returned by BattleManager.getBattle (named struct fields). */
export interface Battle {
  status: number;
  winningSide: number;
  feedA: `0x${string}`;
  feedB: `0x${string}`;
  tokenA: `0x${string}`;
  tokenB: `0x${string}`;
  openTime: bigint;
  lockTime: bigint;
  settleTime: bigint;
  winnerSlots: number;
  maxEntriesPerBattle: number;
  totalEntries: number;
  updownPriceUsd8: bigint;
  requiredUpdownPerEntry: bigint;
  openPriceA: bigint;
  openPriceB: bigint;
  closePriceA: bigint;
  closePriceB: bigint;
  rewardToken: `0x${string}`;
  rewardPool: bigint;
  perSlotReward: bigint;
  winnerCount: number;
}

export const fmtUsdc = (v?: bigint, digits = 2) =>
  v === undefined ? "—" : `$${Number(formatUnits(v, USDC_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const fmtUpdown = (v?: bigint) =>
  v === undefined ? "—" : Number(formatUnits(v, UPDOWN_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const statusLabel = (s?: number): string =>
  ({
    [Status.None]: "None",
    [Status.Open]: "Open",
    [Status.Locked]: "Locked",
    [Status.AwaitingDice]: "Awaiting Dice",
    [Status.Settled]: "Settled",
    [Status.Drawn]: "Draw",
    [Status.Cancelled]: "Cancelled",
  }[s ?? -1] ?? "Unknown");

export const sideLabel = (s?: number) =>
  s === Side.A ? "A" : s === Side.B ? "B" : "—";

/** Percentage return (1e18-scaled internally) as a display string. */
export const pctReturn = (open?: bigint, close?: bigint): string => {
  if (!open || open === 0n || close === undefined) return "—";
  const bps = Number(((close - open) * 10000n) / open) / 100;
  return `${bps >= 0 ? "+" : ""}${bps.toFixed(2)}%`;
};

/** Chainlink 8-dp price as a $ string. */
export const fmtPrice8 = (p?: bigint) =>
  p === undefined || p === 0n ? "—" : `$${Number(formatUnits(p, 8)).toFixed(2)}`;

/** Full remaining cutoff duration, including every non-zero day/hour/minute/second unit. */
export const fmtCountdown = (targetSec?: bigint, nowMs = Date.now()): string => {
  if (targetSec === undefined || targetSec <= 0n || !Number.isFinite(nowMs)) return "—";
  let seconds = Number(targetSec) - Math.floor(nowMs / 1000);
  if (seconds <= 0) return "00s";
  const days = Math.floor(seconds / 86400);
  seconds -= days * 86400;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  const units: string[] = [];
  if (days > 0) units.push(`${days}d`);
  if (hours > 0 || days > 0) units.push(`${String(hours).padStart(2, "0")}h`);
  if (minutes > 0 || hours > 0 || days > 0) units.push(`${String(minutes).padStart(2, "0")}m`);
  units.push(`${String(seconds).padStart(2, "0")}s`);
  return units.join(" ");
};