import "./env.js";
import { beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { connectMongo } from "../src/db/mongo.js";
import { connectRedis, disconnectRedis } from "../src/db/redis.js";
import { Agent } from "../src/db/agent.model.js";
import { __resetChallenges } from "../src/services/challenge.service.js";
import { clearAllRuns } from "../src/services/runs.service.js";

beforeAll(async () => {
  await connectMongo();
  await connectRedis();
});

beforeEach(async () => {
  await Agent.deleteMany({});
  __resetChallenges();
  await clearAllRuns();
});

afterAll(async () => {
  await mongoose.disconnect();
  await disconnectRedis();
});
