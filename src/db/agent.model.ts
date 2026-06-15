import { Schema, model, type InferSchemaType } from "mongoose";

const AgentSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    score: { type: Number, default: 0 },
    spendingCapUsd: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type AgentDoc = InferSchemaType<typeof AgentSchema>;
export const Agent = model("Agent", AgentSchema);
