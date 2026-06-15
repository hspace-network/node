import { Schema, model, type InferSchemaType } from "mongoose";

const AnchorPendingSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    roomId: { type: String, required: true },
    closedAt: { type: Date, required: true },
    hourBucket: { type: String, required: true, index: true },
    sessionRoot: { type: String, required: true },
    anchored: { type: Boolean, default: false, index: true },
    txHash: { type: String, default: null },
  },
  { timestamps: false },
);

export type AnchorPendingDoc = InferSchemaType<typeof AnchorPendingSchema>;
export const AnchorPending = model("AnchorPending", AnchorPendingSchema);
