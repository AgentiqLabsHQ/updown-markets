import type { Abi } from "viem";
import battleManagerAbi from "./abis/BattleManager.json";
import rewardVaultAbi from "./abis/RewardVault.json";
import updownAbi from "./abis/UpdownToken.json";
import usdcAbi from "./abis/MockUSDC.json";
import feedAbi from "./abis/MockAggregatorV3.json";

export const CHAIN_ID = 46630;

const env = (k: string, fallback: string) =>
  ((process.env[k] as string | undefined)?.trim() || fallback) as `0x${string}`;

/** Live Robinhood testnet (46630) deployment. Overridable via NEXT_PUBLIC_* env. */
export const CONTRACTS = {
  battleManager: env("NEXT_PUBLIC_BATTLE_MANAGER", "0x27481D71C02ebd54aF6c5B2B4431Cc443a427454"),
  rewardVault: env("NEXT_PUBLIC_REWARD_VAULT", "0x1a0D29Cd5749F74fdE2552c4A8275421a35b554E"),
  dice: env("NEXT_PUBLIC_DICE", "0xB928a3D6080900D1a5793A322c2Ccbd331Ff0F79"),
  updown: env("NEXT_PUBLIC_UPDOWN", "0xEb74957E1cE2e5ae63B419a8Fa6D166E067A4Cf2"),
  usdc: env("NEXT_PUBLIC_USDC", "0xCd32BA7c4dD5d384261727B7289b4A9368d85035"),
  feedA: env("NEXT_PUBLIC_FEED_A", "0xC96BCaD2db3B88E4452dcb8B3b89f995B0a33b4d"),
  feedB: env("NEXT_PUBLIC_FEED_B", "0xB9fE66bB91EAeaFa5027284a24922bFE89ae202B"),
} as const;

export const ABI = {
  battleManager: battleManagerAbi as Abi,
  rewardVault: rewardVaultAbi as Abi,
  updown: updownAbi as Abi,
  usdc: usdcAbi as Abi,
  feed: feedAbi as Abi,
};

export const ENTRY_VALUE_USD8 = 200000000n; // $2.00 at 1e8
export const USDC_DECIMALS = 6;
export const UPDOWN_DECIMALS = 18;

/** Battle.status enum (matches BattleTypes.Status). */
export enum Status {
  None = 0,
  Open = 1,
  Locked = 2,
  AwaitingDice = 3,
  Settled = 4,
  Drawn = 5,
  Cancelled = 6,
}

/** Battle.winningSide / entry side enum (matches BattleTypes.Side). */
export enum Side {
  None = 0,
  A = 1,
  B = 2,
}
