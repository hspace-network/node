import type { AgentDoc } from "../db/agent.model.js";

export class ExcellenceEngine {
  async computeScore(_agent: AgentDoc): Promise<number> {
    return 0;
  }
}

export const excellenceEngine = new ExcellenceEngine();
