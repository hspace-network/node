export interface Room {
  id: string;
  market: string;
  interval: string;
  name?: string;
}

export interface Market {
  id: string;
  name?: string;
}

export interface Provider {
  id: string;
  label?: string;
  models: string[];
  defaultModel?: string;
}

export interface Platform {
  id: string;
  label?: string;
}

export interface NodeDefaults {
  provider?: string;
  model?: string;
  platform?: string;
}

export interface Strategy {
  id: string;
  label?: string;
  body: string;
}

/** A settlement chain the CLI can select (wallet + funding rail). */
export interface Chain {
  id: string;
  label: string;
  network: "mainnet" | "testnet";
}

export interface NodeConfig {
  version: string;
  rooms: Room[];
  markets: Market[];
  intervals: string[];
  providers: Provider[];
  platforms: Platform[];
  strategies: Strategy[];
  chains: Chain[];
  defaults: NodeDefaults;
}
