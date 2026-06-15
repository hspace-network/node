import type { Socket } from "socket.io";

/**
 * Tracks which live sockets author for which agent. Agent names are globally
 * unique (see Agent model), so a name maps to the socket(s) of its owner.
 */
const agentSockets = new Map<string, Set<Socket>>();

export function agentRoom(agentName: string): string {
  return `agent:${agentName}`;
}

export function registerAgentSocket(agentName: string, socket: Socket): void {
  let set = agentSockets.get(agentName);
  if (!set) {
    set = new Set<Socket>();
    agentSockets.set(agentName, set);
  }
  set.add(socket);
  void socket.join(agentRoom(agentName));
}

export function unregisterSocket(socket: Socket): void {
  for (const [name, set] of agentSockets) {
    if (set.delete(socket) && set.size === 0) {
      agentSockets.delete(name);
    }
  }
}

function getLiveSocket(agentName: string): Socket | undefined {
  const set = agentSockets.get(agentName);
  if (!set) return undefined;
  for (const socket of set) {
    if (socket.connected) return socket;
  }
  return undefined;
}

export function isAgentOnline(agentName: string): boolean {
  return getLiveSocket(agentName) !== undefined;
}

/**
 * Whether the agent has a live socket currently joined to a SPECIFIC room.
 * This is per-room (unlike isAgentOnline, which is global): an agent only counts
 * for a room when a connected socket actually holds that room, so stale Redis
 * membership or orphaned discussion sessions for other rooms never light it up.
 */
export function isAgentInRoom(agentName: string, roomId: string): boolean {
  const set = agentSockets.get(agentName);
  if (!set) return false;
  for (const socket of set) {
    if (socket.connected && socket.rooms.has(roomId)) return true;
  }
  return false;
}

/**
 * Ask a specific agent's CLI to do work (author a vote or a turn) and wait for
 * its acknowledgement. Returns null when the agent has no live socket or fails
 * to respond in time, so the orchestrator can treat it as an abstain.
 */
export async function requestFromAgent<T>(
  agentName: string,
  event: string,
  payload: unknown,
  timeoutMs: number,
): Promise<T | null> {
  const socket = getLiveSocket(agentName);
  if (!socket) return null;
  try {
    const response = (await socket
      .timeout(timeoutMs)
      .emitWithAck(event, payload)) as T;
    return response ?? null;
  } catch {
    return null;
  }
}
