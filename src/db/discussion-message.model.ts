import { Schema, model, type InferSchemaType } from "mongoose";

const DiscussionMessageSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    roomId: { type: String, required: true, index: true },
    agentName: { type: String, required: true },
    round: { type: Number, required: true },
    content: { type: String, required: true },
    ts: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export type DiscussionMessageDoc = InferSchemaType<
  typeof DiscussionMessageSchema
>;
export const DiscussionMessage = model(
  "DiscussionMessage",
  DiscussionMessageSchema,
);
