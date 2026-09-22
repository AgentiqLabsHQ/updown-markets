"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as PrivyWagmiProvider, createConfig } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { http } from "wagmi";
import { robinhoodTestnet } from "@/lib/chain";
import { PrivyWalletBridge, WalletContextProvider } from "@/lib/wallet";
import DirectAuthFlow from "@/app/components/direct-auth-flow";

const queryClient = new QueryClient();

export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet],
  transports: {
    [robinhoodTestnet.id]: http(process.env.NEXT_PUBLIC_RH_TESTNET_RPC || "/api/rpc", { batch: { wait: 24 } }),
  },
});

function StandardWalletTree({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <WalletContextProvider>{children}</WalletContextProvider>
    </WagmiProvider>
  );
}

function PrivyWalletTree({ children }: { children: React.ReactNode }) {
  return (
    <PrivyWagmiProvider config={wagmiConfig}>
      <WalletContextProvider>
        <PrivyWalletBridge>{children}</PrivyWalletBridge>
      </WalletContextProvider>
    </PrivyWagmiProvider>
  );
}

function WalletProviders({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <StandardWalletTree>{children}</StandardWalletTree>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: { theme: "dark", accentColor: "#d6b36a", logo: undefined },
        defaultChain: robinhoodTestnet,
        supportedChains: [robinhoodTestnet],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
      }}
    >
      <PrivyWalletTree>{children}</PrivyWalletTree>
    </PrivyProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProviders>
        <DirectAuthFlow />
        {children}
      </WalletProviders>
    </QueryClientProvider>
  );
}