import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envFile = resolve(process.cwd(), ".env.test");
if (!existsSync(envFile)) {
  throw new Error(
    "node/.env.test is missing. Copy .env.test.example to .env.test before running tests.",
  );
}

loadDotenv({ path: envFile, override: true });
