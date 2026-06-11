import { createServer } from "./server.js";
import { config, assertProductionConfig } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import { connectRedis } from "./db/redis.js";
import { startDiscussionScheduler } from "./services/discussion.scheduler.js";

async function main(): Promise<void> {
  assertProductionConfig();
  await connectMongo();
  await connectRedis();

  const { rooms, markets, intervals, providers, platforms, defaults } = config;
  console.log(
    `[node] loaded ${rooms.length} room(s) (${markets.length} market(s) x ${intervals.length} interval(s)), ${providers.length} provider(s), ${platforms.length} platform(s), defaults={provider:${defaults.provider ?? "-"}, model:${defaults.model ?? "-"}, platform:${defaults.platform ?? "-"}}`,
  );
  console.log(
    `[node] agent registration: ${config.agentRegistrationEnabled ? "enabled" : "disabled"}`,
  );

  const { httpServer, io } = createServer();

  startDiscussionScheduler(io);

  httpServer.listen(config.port, () => {
    console.log(`[node] listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error("[node] fatal:", err);
  process.exit(1);
});
