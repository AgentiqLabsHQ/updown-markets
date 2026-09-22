import { createConfig } from "ponder";
import { http } from "viem";
import { BattleManagerAbi } from "./abis/BattleManager";

export default createConfig({
  networks: {
    rhTestnet: {
      chainId: 46630,
      transport: http(
        process.env.PONDER_RPC_URL_46630 || "https://rpc.testnet.chain.robinhood.com",
      ),
    },
  },
  contracts: {
    BattleManager: {
      network: "rhTestnet",
      abi: BattleManagerAbi,
      address: (process.env.BATTLE_MANAGER_ADDRESS ||
        "0x9737e6A983668D6AD677e72806c5cF53031cD639") as `0x${string}`,
      startBlock: Number(process.env.START_BLOCK || 114635386),
    },
  },
});
