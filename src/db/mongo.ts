import mongoose from "mongoose";
import { config } from "../config.js";

export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongodbUri);
  const { host, name } = mongoose.connection;
  console.log(`[mongo] connected: ${host}/${name}`);
}
