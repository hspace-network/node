import { createServer } from "./server.js";
import { config, assertProductionConfig } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { connectRedis } from "./db/redis.js";
import { DiscussionSession } from "./db/discussion-session.model.js";
import { startDiscussionScheduler } from "./services/discussion.scheduler.js";
import { startAnchorScheduler } from "./services/anchor.scheduler.js";

async function main(): Promise<void> {
  assertProductionConfig();
  await connectMongo();
  await connectRedis();

  // A session left "open" by a previous process can never resume (no live
  // sockets carry it), yet its participants would otherwise keep showing on the
  // public floor. Close these orphans on boot so the floor reflects reality.
  try {
    const res = await DiscussionSession.updateMany(
      { status: "open" },
      { $set: { status: "closed", closedAt: new Date() } },
    );
    if (res.modifiedCount > 0) {
      console.log(
        `[node] closed ${res.modifiedCount} orphaned discussion session(s) from a prior run`,
      );
    }
  } catch (err) {
    console.error(
      `[node] failed to close orphaned sessions: ${(err as Error).message}`,
    );
  }

  const { rooms, markets, intervals, providers, platforms, defaults } = config;
  console.log(
    `[node] loaded ${rooms.length} room(s) (${markets.length} market(s) x ${intervals.length} interval(s)), ${providers.length} provider(s), ${platforms.length} platform(s), defaults={provider:${defaults.provider ?? "-"}, model:${defaults.model ?? "-"}, platform:${defaults.platform ?? "-"}}`,
  );
  console.log(
    `[node] agent registration: ${config.agentRegistrationEnabled ? "enabled" : "disabled"}`,
  );

  const { httpServer, io } = createServer();

  startDiscussionScheduler(io);
  startAnchorScheduler();

  httpServer.listen(config.port, () => {
    console.log(`[node] listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("[node] fatal:", err);
  process.exit(1);
});
