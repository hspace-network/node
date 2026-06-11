import { Schema, model, type InferSchemaType } from "mongoose";

const DiscussionSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    roomId: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    participants: { type: [String], default: [] },
    rounds: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },
  },
  { timestamps: false },
);

export type DiscussionSessionDoc = InferSchemaType<
  typeof DiscussionSessionSchema
>;
export const DiscussionSession = model(
  "DiscussionSession",
  DiscussionSessionSchema,
);
