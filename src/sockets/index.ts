import type { Server as IOServer, Socket } from "socket.io";
import { verifySessionToken } from "../services/auth.service.js";
import { Agent } from "../db/agent.model.js";
import {
  addRun,
  removeRun,
  listRoomsForAgent,
  RunsError,
} from "../services/runs.service.js";

interface SocketAuthData {
  address: string;
}

interface RunPayload {
  agentName?: unknown;
  roomId?: unknown;
}

type AckFn = (response: { ok: boolean; error?: string; roomId?: string }) => void;

function getAuth(socket: Socket): SocketAuthData {
  const data = socket.data as Partial<SocketAuthData>;
  if (!data.address) {
    throw new Error("Socket missing auth data.");
  }
  return { address: data.address };
}

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}...`;
}

function parseRunPayload(payload: unknown): {
  agentName: string;
  roomId: string;
} {
  const obj = (payload ?? {}) as RunPayload;
  if (typeof obj.agentName !== "string" || obj.agentName.length === 0) {
    throw new Error("agentName is required.");
  }
  if (typeof obj.roomId !== "string" || obj.roomId.length === 0) {
    throw new Error("roomId is required.");
  }
  return { agentName: obj.agentName, roomId: obj.roomId };
}

async function assertOwnership(
  address: string,
  agentName: string,
): Promise<void> {
  const agent = await Agent.findOne({ name: agentName }).lean();
  if (!agent) {
    throw new Error(`Agent "${agentName}" not found.`);
  }
  if (agent.address.toLowerCase() !== address.toLowerCase()) {
    throw new Error(`Agent "${agentName}" does not belong to this wallet.`);
  }
}

export function attachSockets(io: IOServer): void {
  io.use(async (socket, next) => {
    try {
      const handshakeAuth = (socket.handshake.auth ?? {}) as { token?: string };
      const headerAuth =
        socket.handshake.headers.authorization ??
        socket.handshake.headers.Authorization;
      let token: string | undefined = handshakeAuth.token;
      if (
        !token &&
        typeof headerAuth === "string" &&
        headerAuth.startsWith("Bearer ")
      ) {
        token = headerAuth.slice("Bearer ".length).trim();
      }
      if (!token) {
        return next(new Error("Missing auth token."));
      }
      const session = await verifySessionToken(token);
      socket.data.address = session.address;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("Auth failed."));
    }
  });

  io.on("connection", (socket) => {
    const { address } = getAuth(socket);
    console.log(
      `[socket] connected: ${socket.id} addr=${shortAddr(address)}`,
    );

    socket.on("agent:run", async (payload: unknown, ack?: AckFn) => {
      try {
        const { agentName, roomId } = parseRunPayload(payload);
        await assertOwnership(address, agentName);
        await addRun(address, agentName, roomId);
        socket.join(roomId);
        console.log(
          `[socket] agent:run addr=${shortAddr(address)} agent=${agentName} room=${roomId}`,
        );
        ack?.({ ok: true, roomId });
      } catch (err) {
        const message =
          err instanceof RunsError ? err.message : (err as Error).message;
        console.error(
          `[socket] agent:run failed addr=${shortAddr(address)}: ${message}`,
        );
        ack?.({ ok: false, error: message });
      }
    });

    socket.on("agent:stop", async (payload: unknown, ack?: AckFn) => {
      try {
        const { agentName, roomId } = parseRunPayload(payload);
        await assertOwnership(address, agentName);
        await removeRun(address, agentName, roomId);
        socket.leave(roomId);
        console.log(
          `[socket] agent:stop addr=${shortAddr(address)} agent=${agentName} room=${roomId}`,
        );
        ack?.({ ok: true, roomId });
      } catch (err) {
        const message =
          err instanceof RunsError ? err.message : (err as Error).message;
        console.error(
          `[socket] agent:stop failed addr=${shortAddr(address)}: ${message}`,
        );
        ack?.({ ok: false, error: message });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[socket] disconnected: ${socket.id} addr=${shortAddr(address)} (${reason})`,
      );
    });

    void (async () => {
      try {
        const myAgents = await Agent.find({
          address: address.toLowerCase(),
        }).lean();
        for (const agent of myAgents) {
          const rooms = await listRoomsForAgent(address, agent.name);
          for (const roomId of rooms) {
            socket.join(roomId);
          }
        }
      } catch (err) {
        console.error(
          `[socket] hydrate error for ${shortAddr(address)}: ${(err as Error).message}`,
        );
      }
    })();
  });
}
