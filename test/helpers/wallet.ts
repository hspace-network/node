import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";

export interface TestWallet {
  privateKey: `0x${string}`;
  address: string;
  account: PrivateKeyAccount;
  sign(message: string): Promise<`0x${string}`>;
}

export function makeWallet(): TestWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
    account,
    sign(message: string) {
      return account.signMessage({ message });
    },
  };
}
