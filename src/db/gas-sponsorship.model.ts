import { Schema, model, type InferSchemaType } from "mongoose";

/**
 * Audit log of operator-sponsored gas drips (gasless onboarding). Used to
 * enforce one drip per address and a rolling 24h global budget.
 */
const GasSponsorshipSchema = new Schema(
  {
    address: { type: String, required: true, index: true },
    amountWei: { type: String, required: true },
    chain: { type: String, required: true },
    // Empty until the on-chain send confirms. A "reserved" row claims budget
    // before sending so concurrent drips cannot collectively overspend.
    txHash: { type: String, default: "" },
    status: {
      type: String,
      enum: ["reserved", "sent"],
      default: "reserved",
      index: true,
    },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

export type GasSponsorshipDoc = InferSchemaType<typeof GasSponsorshipSchema>;
export const GasSponsorship = model("GasSponsorship", GasSponsorshipSchema);
