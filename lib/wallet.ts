"use client";

import { createContext, createElement, useContext } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

type WalletState = {
  ready: boolean;
  authenticated: boolean;
  isConnected: boolean;
  address: `0x${string}` | undefined;
  login: () => void;
  logout: () => void;
};

const disconnected: WalletState = {
  ready: true,
  authenticated: false,
  isConnected: false,
  address: undefined,
  login: () => undefined,
  logout: () => undefined,
};

const WalletContext = createContext<WalletState>(disconnected);

export function WalletContextProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const current = useContext(WalletContext);
  return createElement(
    WalletContext.Provider,
    { value: { ...current, isConnected: current.authenticated && isConnected, address: address as `0x${string}` | undefined } },
    children,
  );
}

export function PrivyWalletBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address, isConnected } = useAccount();
  return createElement(
    WalletContext.Provider,
    { value: { ready, authenticated, isConnected: authenticated && isConnected, address: address as `0x${string}` | undefined, login, logout } },
    children,
  );
}

export function useWallet() {
  return useContext(WalletContext);
}