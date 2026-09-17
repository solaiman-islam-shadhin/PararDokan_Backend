import { Response } from "express";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { getEffectiveSubscription } from "../utils/subscription";
import { ObjectId, Document } from "mongodb";

type OpeningDay = { enabled: boolean; open: string; close: string };
type OpeningHours = Record<string, OpeningDay>;

const dayKeys = ["0", "1", "2", "3", "4", "5", "6"];

function isOpenBySchedule(shop: { isOpen?: boolean; scheduleEnabled?: boolean; openingHours?: OpeningHours }) {
  if (!shop.scheduleEnabled || !shop.openingHours) return Boolean(shop.isOpen);
  const now = new Date();
  const day = shop.openingHours[String(now.getDay())];
  if (!day?.enabled) return false;
  const current = new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.APP_TIMEZONE || "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return day.open <= current && current < day.close;
}

function withLiveStatus<T extends Document & { isOpen?: boolean; scheduleEnabled?: boolean; openingHours?: OpeningHours }>(shop: T) {
  return { ...shop, isOpen: isOpenBySchedule(shop) };
}

function validateOpeningHours(value: unknown): value is OpeningHours {
  if (!value || typeof value !== "object") return false;
  return dayKeys.every((key) => {
    const day = (value as Record<string, OpeningDay>)[key];
    return Boolean(day && typeof day.enabled === "boolean" &&
      /^\d{2}:\d{2}$/.test(day.open) && /^\d{2}:\d{2}$/.test(day.close) &&
      day.open < day.close);
  });
}

export async function getNearbyShops(req: AuthRequest, res: Response) {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: "Valid coordinates are required" });
    }

    const db = getDB();
    res.set("Cache-Control", "no-store");
    const shops = await db.collection("shops").find({
        location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [longitude, latitude],
            },
            $maxDistance: 1000,
          },
        },
      }).toArray();

    res.json(shops.map(withLiveStatus));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function searchShops(req: AuthRequest, res: Response) {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) return res.json([]);
    const db = getDB();
    const shops = await db.collection("shops")
      .find({ name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })
      .project({ name: 1, address: 1, location: 1, isOpen: 1, scheduleEnabled: 1, openingHours: 1 })
      .limit(20)
      .toArray();
    res.json(shops.map(withLiveStatus));
  } catch (err) {
    res.status(500).json({ error: "Failed to search shops" });
  }
}

export async function getMapShops(_req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    res.set("Cache-Control", "no-store");
    const shops = await db.collection("shops")
      .find({ location: { $exists: true } })
      .project({ name: 1, address: 1, location: 1, isOpen: 1, scheduleEnabled: 1, openingHours: 1 })
      .toArray();
    res.json(shops.map(withLiveStatus));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyShop(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    res.json(withLiveStatus(shop));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function createShop(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const existing = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (existing) return res.status(400).json({ error: "Shop already exists" });

    const { name, address, latitude, longitude } = req.body;
    const location =
      latitude && longitude
        ? { type: "Point", coordinates: [longitude, latitude] }
        : undefined;

    const result = await db.collection("shops").insertOne({
      ownerId: req.uid,
      name,
      address,
      latitude,
      longitude,
      location,
      isOpen: false,
      scheduleEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, shopId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }

}

export async function updateSchedule(req: AuthRequest, res: Response) {
  try {
    const { scheduleEnabled, openingHours } = req.body;
    if (typeof scheduleEnabled !== "boolean" || !validateOpeningHours(openingHours)) {
      return res.status(400).json({ error: "A valid weekly opening schedule is required" });
    }
    const db = getDB();
    await db.collection("shops").updateOne(
      { ownerId: req.uid },
      { $set: { scheduleEnabled, openingHours, updatedAt: new Date() } }
    );
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    res.json(shop ? withLiveStatus(shop) : { success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update opening schedule" });
  }
}

export async function updateOpenStatus(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { isOpen } = req.body;

    await db
      .collection("shops")
      .updateOne(
        { ownerId: req.uid },
        { $set: { isOpen: Boolean(isOpen), updatedAt: new Date() } }
      );

    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    res.json(shop ? withLiveStatus(shop) : { success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getPaymentSettings(req: AuthRequest, res: Response) {
    const db = getDB();
    const shop = await db.collection("shops").findOne(
      { _id: new ObjectId(req.params.id) },
      { projection: { paymentMethods: 1 } }
    );
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const methods = Array.isArray(shop.paymentMethods)
      ? shop.paymentMethods
      : Object.entries(shop.paymentMethods || {})
          .filter(([, phone]) => phone)
          .map(([name, phone]) => ({ name, phone }));
    res.json(methods);
  }

  export async function updatePaymentSettings(req: AuthRequest, res: Response) {
    const methods = Array.isArray(req.body?.methods) ? req.body.methods : [];
    const paymentMethods = methods
      .map((method: { name?: string; phone?: string }) => ({
        name: String(method.name || "").trim(),
        phone: String(method.phone || "").trim(),
      }))
      .filter((method: { name: string; phone: string }) => method.name && method.phone);
    if (paymentMethods.length > 2) {
      const subscription = await getEffectiveSubscription(getDB(), req.uid!);
      if (subscription.planId === "basic") return res.status(403).json({ error: "Basic plan allows only 2 payment methods" });
    }
    const db = getDB();
    const result = await db.collection("shops").updateOne(
      { ownerId: req.uid },
      { $set: { paymentMethods, updatedAt: new Date() } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: "Shop not found" });
    res.json(paymentMethods);
}
