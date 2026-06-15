import { describe, it, expect } from "vitest";

// Mirror of cli validateChainNetworkPair for node-side doc; CLI has its own copy.
function validateChainNetworkPair(
  chain: "mantle" | "mantle-sepolia",
  network: "mainnet" | "testnet",
): string | null {
  if (chain === "mantle" && network !== "mainnet") {
    return 'Chain "mantle" must be paired with Bybit network "mainnet".';
  }
  if (chain === "mantle-sepolia" && network !== "testnet") {
    return 'Chain "mantle-sepolia" must be paired with Bybit network "testnet".';
  }
  return null;
}

describe("validateChainNetworkPair", () => {
  it("accepts valid pairs", () => {
    expect(validateChainNetworkPair("mantle", "mainnet")).toBeNull();
    expect(validateChainNetworkPair("mantle-sepolia", "testnet")).toBeNull();
  });

  it("rejects mismatched pairs", () => {
    expect(validateChainNetworkPair("mantle", "testnet")).not.toBeNull();
    expect(validateChainNetworkPair("mantle-sepolia", "mainnet")).not.toBeNull();
  });
});
