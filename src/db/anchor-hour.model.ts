import { Schema, model, type InferSchemaType } from "mongoose";

const AnchorHourSchema = new Schema(
  {
    hourBucket: { type: String, required: true, unique: true, index: true },
    hourlyRoot: { type: String, required: true },
    sessionCount: { type: Number, required: true },
    txHash: { type: String, default: null },
    anchoredAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

export type AnchorHourDoc = InferSchemaType<typeof AnchorHourSchema>;
export const AnchorHour = model("AnchorHour", AnchorHourSchema);
