import { defineChain } from "viem";

/** Robinhood Chain testnet (Arbitrum L2). Chain id 46630 (0xb626). */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    // Absolute public RPC — this is what the wallet (MetaMask) adds/uses when it
    // switches to the network. Must be absolute (MetaMask can't use a relative URL).
    // App reads use the /api/rpc proxy instead (configured on the wagmi transport).
    default: {
      http: [
        process.env.NEXT_PUBLIC_RH_TESTNET_PUBLIC_RPC ||
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});
