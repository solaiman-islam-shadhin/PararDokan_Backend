import { Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { getEffectiveSubscription } from "../utils/subscription";

const VALID_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "preparing",
  "delivered",
  "completed",
  "cancelled",
];

export async function createOrder(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { shopId, items, quantity, notes, paymentMethod, paymentProvider, estimatedAmount } = req.body;

    if (!shopId) return res.status(400).json({ error: "shopId is required" });

    const shop = await db
      .collection("shops")
      .findOne({ _id: new ObjectId(shopId) });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const subscription = await getEffectiveSubscription(db, shop.ownerId);
    if (subscription.planId === "basic") {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthlyOrders = await db.collection("orders").countDocuments({
        shopId,
        createdAt: { $gte: monthStart },
      });
      if (monthlyOrders >= 50) {
        return res.status(403).json({
          error: "Basic plan allows up to 50 orders per month. Upgrade to Premium for unlimited orders.",
        });
      }
    }
    if (!["cod", "baki", "online"].includes(paymentMethod)) {
      return res.status(400).json({ error: "A valid payment method is required" });
    }
    if (paymentMethod === "baki") {
      const member = await db.collection("baki_members").findOne({
        shopId, customerId: req.uid, status: "approved",
      });
      if (!member) return res.status(400).json({ error: "You are not an approved baki member for this shop" });
    }
    if ((paymentMethod === "online" || paymentMethod === "baki") &&
      (!Number.isFinite(Number(estimatedAmount)) || Number(estimatedAmount) <= 0)) {
      return res.status(400).json({ error: "Enter a valid estimated order amount" });
    }

    const result = await db.collection("orders").insertOne({
      customerId: req.uid,
      shopId,
      shopName: shop.name,
      items,
      quantity,
      notes,
      paymentMethod,
      paymentProvider: paymentMethod === "online" ? paymentProvider : undefined,
      estimatedAmount: estimatedAmount ? Number(estimatedAmount) : undefined,
      bakiCharged: false,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, orderId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyOrders(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const orders = await db
      .collection("orders")
      .find({ customerId: req.uid })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getShopOrders(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const orders = await db
      .collection("orders")
      .find({ shopId: shop._id.toString() })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateOrderStatus(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { id } = req.params;
    const { status, billedAmount } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    const order = shop
      ? await db.collection("orders").findOne({ _id: new ObjectId(id), shopId: shop._id.toString() })
      : null;
    if (!order) return res.status(404).json({ error: "Order not found" });
    const amount = Number(billedAmount || order.estimatedAmount);
    if (status === "approved" && (!Number.isFinite(amount) || amount <= 0)) {
      return res.status(400).json({ error: "Enter the final order amount before approving" });
    }
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "approved") updates.billedAmount = amount;
    if (status === "approved" && order.paymentMethod === "baki" && !order.bakiCharged) {
      const member = await db.collection("baki_members").findOneAndUpdate(
        {
          shopId: order.shopId,
          customerId: order.customerId,
          status: "approved",
          $or: [
            { creditLimit: { $exists: false } },
            { $expr: { $lte: [{ $add: ["$balance", amount] }, "$creditLimit"] } },
          ],
        },
        { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
        { returnDocument: "after" }
      );
      if (!member) return res.status(400).json({ error: "This order exceeds the customer's available credit limit" });
      updates.bakiCharged = true;
      updates.bakiChargedAt = new Date();
    }
    await db.collection("orders").updateOne({ _id: order._id }, { $set: updates });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
