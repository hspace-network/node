import { Schema, model, type InferSchemaType } from "mongoose";

export type VoteWay = "LONG" | "SHORT" | "NOTR";
export type VotePhase = "initial" | "final";

const VoteSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    roomId: { type: String, required: true, index: true },
    agentName: { type: String, required: true, index: true },
    phase: {
      type: String,
      enum: ["initial", "final"],
      required: true,
    },
    way: {
      type: String,
      enum: ["LONG", "SHORT", "NOTR"],
      required: true,
    },
    rationale: { type: String, default: "" },
    sizeUsd: { type: Number, default: 0 },
    ts: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

VoteSchema.index({ sessionId: 1, agentName: 1, phase: 1 }, { unique: true });

export type VoteDoc = InferSchemaType<typeof VoteSchema>;
export const Vote = model("Vote", VoteSchema);
