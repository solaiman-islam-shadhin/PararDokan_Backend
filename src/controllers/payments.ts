import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { getEffectiveSubscription } from "../utils/subscription";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
  timeout: 20000,
  maxNetworkRetries: 2,
});
const MIN_STRIPE_BDT = 100;

// ─── Stripe Checkout ────────────────────────────────────────────────────────
export async function stripeCheckout(req: AuthRequest, res: Response) {
  try {
    const { amount, bakiId, shopId } = req.body;
    const numericAmount = Number(amount);
    if (!bakiId || !shopId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "A valid baki and amount are required" });
    }

    const db = getDB();
    const baki = await db.collection("baki_members").findOne({
      _id: new ObjectId(bakiId),
      shopId,
      customerId: req.uid,
      status: "approved",
    });
    if (!baki || numericAmount > baki.balance) {
      return res.status(400).json({ error: "Payment cannot exceed the outstanding baki balance" });
    }
    if (numericAmount < MIN_STRIPE_BDT) {
      return res.status(400).json({ error: `Stripe payments must be at least ৳${MIN_STRIPE_BDT}. Use bKash or Nagad for smaller payments.` });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: "Baki Payment" },
            unit_amount: Math.round(numericAmount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/customer/payments?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/customer/payments?cancelled=true`,
      metadata: {
        customerId: req.uid!,
        bakiId,
        shopId,
        type: "baki",
      },
    });

    // Save pending payment record
    await db.collection("payments").insertOne({
      customerId: req.uid,
      shopId,
      bakiId,
      amount: numericAmount,
      method: "stripe",
      status: "pending",
      sessionId: session.id,
      type: "baki",
      createdAt: new Date(),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Baki checkout failed:", err);
    const message = err instanceof Error ? err.message : "Stripe checkout failed";
    res.status(500).json({ error: message });
  }

}

export async function orderCheckout(req: AuthRequest, res: Response) {
  try {
    const { amount } = req.body;
    const db = getDB();
    const order = await db.collection("orders").findOne({
      _id: new ObjectId(req.params.id), customerId: req.uid, paymentMethod: "online",
    });
    if (!order || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "A valid online order and amount are required" });
    }
    if (Number(amount) < MIN_STRIPE_BDT) {
      return res.status(400).json({ error: `Stripe payments must be at least ৳${MIN_STRIPE_BDT}. Use bKash or Nagad for smaller payments.` });
    }
    const tranId = `ORDER_${Date.now()}_${req.uid}`;
    await db.collection("payments").insertOne({
      customerId: req.uid, shopId: order.shopId, orderId: order._id.toString(),
      amount: Number(amount),       method: "stripe",
      status: "pending", tranId, type: "order", createdAt: new Date(),
    });
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], mode: "payment",
      line_items: [{ price_data: { currency: "bdt", product_data: { name: "Parar Dokan Order" }, unit_amount: Math.round(Number(amount) * 100) }, quantity: 1 }],
      success_url: `${process.env.CLIENT_URL}/customer/orders?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/customer/orders?cancelled=true`,
      metadata: { customerId: req.uid!, orderId: order._id.toString(), type: "order" },
    });
    await db.collection("payments").updateOne({ tranId }, { $set: { sessionId: session.id } });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Online order checkout failed" });
  }
}

// ─── Stripe Subscription Checkout ───────────────────────────────────────────
export async function stripeSubscriptionCheckout(
  req: AuthRequest,
  res: Response
) {
  try {
    const { planId, billingCycle = "monthly" } = req.body;
    const plans = getSubscriptionPlans();
    const plan = plans.find((item) => item.id === planId);
    if (!plan || plan.id === "basic" || plan.id === "enterprise") {
      return res.status(400).json({ error: "This plan is not available for online checkout" });
    }
    const amount = billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
    if (!amount || !["monthly", "annual"].includes(billingCycle)) {
      return res.status(400).json({ error: "A valid billing cycle is required" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "bdt",
            product_data: { name: `Parar Dokan ${plan.name} Plan (${billingCycle})` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/shopkeeper/profile?sub=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/shopkeeper/profile?sub=cancelled`,
      metadata: {
        shopkeeperId: req.uid!,
        planId,
        billingCycle,
        type: "subscription",
      },
    });

    const db = getDB();
    await db.collection("subscriptions").insertOne({
      shopkeeperId: req.uid,
      planId,
      amount: Number(amount),
      billingCycle,
      expiresAt: new Date(Date.now() + (billingCycle === "annual" ? 365 : 30) * 24 * 60 * 60 * 1000),
      method: "stripe",
      status: "pending",
      sessionId: session.id,
      createdAt: new Date(),
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: "Stripe subscription checkout failed" });
  }
}

  /**
   * Stripe sends this request independently of the browser redirect. The
   * checkout record is therefore activated here, rather than trusting the
   * success URL.
   */
  async function handleStripeWebhook(
    req: Request,
    res: Response,
    secret: string | undefined
  ) {
    const signature = req.headers["stripe-signature"];
    if (!signature || !secret) {
      return res.status(400).send("Stripe webhook is not configured");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature,
        secret
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const session = event.data.object as Stripe.Checkout.Session;
      const db = getDB();
      await settleCheckoutSession(session, db);
    }

    res.json({ received: true });
  }

  async function settleCheckoutSession(session: Stripe.Checkout.Session, db = getDB()) {
    if (session.payment_status !== "paid") return;

    const pendingPayment = await db.collection("payments").findOne({
      sessionId: session.id,
      status: "pending",
    });
    if (pendingPayment) {
      const payment = await db.collection("payments").updateOne(
        { _id: pendingPayment._id, status: "pending" },
        { $set: { status: "paid", paidAt: new Date() } }
      );

      if (
        payment.modifiedCount === 1 &&
        pendingPayment.type === "baki" &&
        pendingPayment.bakiId
      ) {
        const amount = Number(pendingPayment.amount);
        await db.collection("baki_members").updateOne(
          {
            _id: new ObjectId(pendingPayment.bakiId),
            customerId: pendingPayment.customerId,
            shopId: pendingPayment.shopId,
            status: "approved",
            balance: { $gte: amount },
          },
          { $inc: { balance: -amount }, $set: { updatedAt: new Date() } }
        );
      }
    }

    if (session.metadata?.type === "subscription") {
      await db.collection("subscriptions").updateOne(
        { sessionId: session.id },
        {
          $set: {
            status: "active",
            paymentStatus: session.payment_status,
            billingCycle: session.metadata?.billingCycle || "monthly",
            expiresAt: new Date(
              Date.now() +
                (session.metadata?.billingCycle === "annual" ? 365 : 30) *
                  24 *
                  60 *
                  60 *
                  1000
            ),
            paidAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
    } else if (session.metadata?.type === "order") {
      await db.collection("payments").updateOne(
        { orderId: session.metadata.orderId, sessionId: session.id },
        { $set: { status: "paid", paidAt: new Date() } }
      );
    }
  }

  export async function confirmStripePayment(req: AuthRequest, res: Response) {
    try {
      const sessionId = String(req.query.session_id || "");
      if (!sessionId) return res.status(400).json({ error: "session_id is required" });

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.customerId !== req.uid) {
        return res.status(403).json({ error: "This payment does not belong to you" });
      }

      await settleCheckoutSession(session);
      res.json({ status: session.payment_status });
    } catch (err) {
      res.status(500).json({ error: "Unable to confirm Stripe payment" });
    }
  }

  export async function confirmStripeSubscription(req: AuthRequest, res: Response) {
    try {
      const sessionId = String(req.query.session_id || "");
      if (!sessionId) return res.status(400).json({ error: "session_id is required" });

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.metadata?.shopkeeperId !== req.uid) {
        return res.status(403).json({ error: "This subscription does not belong to you" });
      }

      await settleCheckoutSession(session);
      res.json({ status: session.payment_status });
    } catch (err) {
      res.status(500).json({ error: "Unable to confirm Stripe subscription" });
    }
  }

  export function stripePaymentWebhook(req: Request, res: Response) {
    return handleStripeWebhook(
      req,
      res,
      process.env.STRIPE_PAYMENT_WEBHOOK_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET
    );
  }

  export function stripeSubscriptionWebhook(req: Request, res: Response) {
    return handleStripeWebhook(
      req,
      res,
      process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET
    );
  }

// ─── Get My Payments (customer) ──────────────────────────────────────────────
export async function getMyPayments(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const payments = await db
      .collection("payments")
      .find({ customerId: req.uid })
      .sort({ createdAt: -1 })
      .toArray();
    const customerIds = [...new Set(payments.map((payment) => payment.customerId).filter(Boolean))];
    const customers = await db
      .collection("user_profiles")
      .find({ firebaseUid: { $in: customerIds } })
      .project({ firebaseUid: 1, name: 1, email: 1, phoneNumber: 1, address: 1 })
      .toArray();
    const customerById = new Map(customers.map((customer) => [customer.firebaseUid, customer]));
    res.json(payments.map((payment) => ({
      ...payment,
      customer: customerById.get(payment.customerId) || null,
    })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

// ─── Get Shop Payments (shopkeeper) ─────────────────────────────────────────
export async function getShopPayments(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const payments = await db
      .collection("payments")
      .find({ shopId: shop._id.toString() })
      .sort({ createdAt: -1 })
      .toArray();
    const customerIds = [
      ...new Set(payments.map((payment) => payment.customerId).filter(Boolean)),
    ];
    const customers = await db
      .collection("user_profiles")
      .find({ firebaseUid: { $in: customerIds } })
      .project({ firebaseUid: 1, name: 1, email: 1, phoneNumber: 1, address: 1 })
      .toArray();
    const customerById = new Map(
      customers.map((customer) => [customer.firebaseUid, customer])
    );
    res.json(
      payments.map((payment) => ({
        ...payment,
        customer: customerById.get(payment.customerId) || null,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

// ─── Verify Payment ──────────────────────────────────────────────────────────
export async function verifyPayment(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { id } = req.params;

    const payment = await db.collection("payments").findOne({ _id: new ObjectId(id), method: { $ne: "stripe" } });
    if (!payment) return res.status(404).json({ error: "Manual payment not found" });
    const shop = await db.collection("shops").findOne({ _id: new ObjectId(payment.shopId), ownerId: req.uid });
    if (!shop) return res.status(403).json({ error: "You cannot verify this payment" });
    const updated = await db.collection("payments").updateOne(
      { _id: payment._id, status: "pending" },
      { $set: { status: "verified", verifiedAt: new Date() } }
    );
    if (!updated.modifiedCount) return res.status(409).json({ error: "Payment has already been processed" });
    if (payment.bakiId) {
      await db.collection("baki_members").updateOne(
        { _id: new ObjectId(payment.bakiId), balance: { $gte: payment.amount } },
        { $inc: { balance: -payment.amount }, $set: { updatedAt: new Date() } }
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function submitManualPayment(req: AuthRequest, res: Response) {
    try {
      const { amount, bakiId, orderId, shopId, method, tranId } = req.body || {};
      const numericAmount = Number(amount);
      if (!method?.trim() || method === "stripe" || !tranId?.trim() || !shopId || !Number.isFinite(numericAmount) || numericAmount <= 0 || (!bakiId && !orderId)) {
        return res.status(400).json({ error: "Payment method, transaction ID, order or baki, and amount are required" });
      }
      const db = getDB();
      if (bakiId) {
        const baki = await db.collection("baki_members").findOne({ _id: new ObjectId(bakiId), shopId, customerId: req.uid, status: "approved" });
        if (!baki || numericAmount > baki.balance) return res.status(400).json({ error: "Payment cannot exceed the outstanding baki balance" });
      } else {
        const order = await db.collection("orders").findOne({ _id: new ObjectId(orderId), shopId, customerId: req.uid });
        if (!order) return res.status(404).json({ error: "Order not found" });
      }
      const shop = await db.collection("shops").findOne({ _id: new ObjectId(shopId) });
      const acceptedMethods = Array.isArray(shop?.paymentMethods)
        ? shop.paymentMethods
        : Object.entries(shop?.paymentMethods || {}).map(([name, phone]) => ({ name, phone }));
      const normalizeMethod = (value: string) => value.trim().toLowerCase().replace("bkash", "bKash");
      if (!acceptedMethods.some((item: { name?: string }) => normalizeMethod(item.name || "") === normalizeMethod(method))) return res.status(400).json({ error: "This shop does not accept that payment method" });
      const duplicate = await db.collection("payments").findOne({ method, tranId: tranId.trim() });
      if (duplicate) return res.status(409).json({ error: "This transaction ID has already been submitted" });
      const result = await db.collection("payments").insertOne({
        customerId: req.uid, shopId, ...(bakiId ? { bakiId } : { orderId }), amount: numericAmount, method, tranId: tranId.trim(),
        status: "pending", type: bakiId ? "baki" : "order", createdAt: new Date(),
      });
      res.status(201).json({ success: true, paymentId: result.insertedId });
    } catch {
      res.status(500).json({ error: "Could not submit payment" });
    }
  }

// ─── Get Subscriptions ───────────────────────────────────────────────────────
export async function getMySubscription(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const effective = await getEffectiveSubscription(db, req.uid!);
    const plan = getSubscriptionPlans().find((item) => item.id === effective.planId)!;
    res.json({
      ...(effective.subscription || {}),
      planId: effective.planId,
      name: plan.name,
      status: effective.status,
      method: effective.subscription?.method || "free",
      amount: effective.subscription?.amount || 0,
      expiresAt: effective.expiresAt,
      remainingDays: effective.remainingDays,
      isExpired: effective.status === "expired",
      features: plan.features,
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export function getPricing(_req: Request, res: Response) {
  res.json(getSubscriptionPlans());
}

function getSubscriptionPlans() {
  return [
    {
      id: "basic",
      name: "Basic",
      monthlyPrice: 0,
      annualPrice: 0,
      features: ["Up to 50 orders/month", "Up to 20 Baki members", "Basic analytics"],
    },
    {
      id: "premium",
      name: "Premium",
      monthlyPrice: 599,
      annualPrice: 5990,
      features: [
        "Unlimited orders and sales",
        "Baki management",
        "Advanced analytics",
        "Priority support",
      ],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      monthlyPrice: null,
      annualPrice: null,
      features: [
        "Everything in Premium",
        "Multiple shops",
        "Custom branding",
        "Dedicated account support",
      ],
    },
  ];
}
