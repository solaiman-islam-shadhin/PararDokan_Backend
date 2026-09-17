import { Db } from "mongodb";

export const BASIC_PLAN_ID = "basic";

export type EffectiveSubscription = {
  planId: string;
  status: "active" | "basic" | "expired" | "pending";
  expiresAt?: Date;
  remainingDays: number | null;
  subscription?: any;
};

/**
 * Returns the plan that may actually be used for feature enforcement.
 * Pending, failed, cancelled and expired paid subscriptions never grant
 * Premium features.
 */
export async function getEffectiveSubscription(
  db: Db,
  shopkeeperId: string
): Promise<EffectiveSubscription> {
  const subscription = await db
    .collection("subscriptions")
    .findOne({ shopkeeperId }, { sort: { createdAt: -1 } });
  const now = new Date();
  const expiresAt = subscription?.expiresAt
    ? new Date(subscription.expiresAt)
    : undefined;
  const isPaid = subscription?.paymentStatus === undefined ||
    subscription.paymentStatus === "paid";
  const isPremium =
    subscription !== null &&
    ["premium", "enterprise"].includes(subscription.planId) &&
    subscription.status === "active" &&
    isPaid &&
    (!expiresAt || expiresAt > now);

  if (isPremium) {
    const activeSubscription = subscription;
    return {
      planId: activeSubscription.planId,
      status: "active",
      expiresAt,
      remainingDays: expiresAt
        ? Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000))
        : null,
      subscription: activeSubscription,
    };
  }

  // Keep the record auditable while ensuring an expired active subscription
  // cannot be selected by older code or a stale dashboard response.
  if (
    subscription &&
    subscription.status === "active" &&
    expiresAt &&
    expiresAt <= now
  ) {
    await db.collection("subscriptions").updateOne(
      { _id: subscription._id, status: "active" },
      { $set: { status: "expired", downgradedAt: now, updatedAt: now } }
    );
  }

  return {
    planId: BASIC_PLAN_ID,
    status:
      expiresAt && expiresAt <= now
        ? "expired"
        : subscription?.status === "pending"
          ? "pending"
          : "basic",
    remainingDays: 0,
    expiresAt,
    subscription,
  };
}
