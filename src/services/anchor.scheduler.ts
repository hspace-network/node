import { anchorHourBucket } from "./anchor.service.js";
import { config } from "../config.js";

let lastRunHour = "";

function previousUtcHourBucket(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() - 1);
  return d.toISOString().slice(0, 13);
}

async function tick(): Promise<void> {
  const now = new Date();
  if (now.getUTCMinutes() !== 5) return;

  const targetHour = previousUtcHourBucket();
  if (lastRunHour === targetHour) return;
  lastRunHour = targetHour;

  try {
    await anchorHourBucket(targetHour);
  } catch (err) {
    console.error(`[anchor] scheduler tick failed: ${(err as Error).message}`);
  }
}

export function startAnchorScheduler(): () => void {
  if (!config.anchorEnabled) {
    console.log("[anchor] scheduler disabled (ANCHOR_ENABLED=false)");
    return () => undefined;
  }

  const timer = setInterval(() => {
    void tick();
  }, 30_000);
  timer.unref?.();

  console.log("[anchor] scheduler started (runs at :05 UTC each hour)");
  return () => clearInterval(timer);
}
