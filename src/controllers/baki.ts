import { Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";
import { getEffectiveSubscription } from "../utils/subscription";

function distanceInMeters(first: any, second: any) {
  const [firstLng, firstLat] = first.coordinates;
  const [secondLng, secondLat] = second.coordinates;
  const radians = (value: number) => (value * Math.PI) / 180;
  const latDelta = radians(secondLat - firstLat);
  const lngDelta = radians(secondLng - firstLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(firstLat)) * Math.cos(radians(secondLat)) * Math.sin(lngDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function createMemberCode(db: ReturnType<typeof getDB>, shopId: string) {
  const members = await db.collection("baki_members").find({ shopId }).project({ memberCode: 1 }).toArray();
  const highest = members.reduce((max, member) => {
    const value = Number(member.memberCode);
    return Number.isInteger(value) ? Math.max(max, value) : max;
  }, 0);
  if (highest >= 999) throw new Error("This shop has reached the 3-digit Baki member ID limit");
  return String(highest + 1).padStart(2, "0");
}

async function ensureMemberCode(db: ReturnType<typeof getDB>, member: any) {
  if (member.memberCode && /^\d{2,3}$/.test(String(member.memberCode))) return member;
  const memberCode = await createMemberCode(db, member.shopId);
  await db.collection("baki_members").updateOne({ _id: member._id }, { $set: { memberCode } });
  return { ...member, memberCode };
}

export async function requestBaki(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { shopId } = req.body;
    if (!shopId) return res.status(400).json({ error: "shopId is required" });
    const shop = await db.collection("shops").findOne({ _id: new ObjectId(shopId) });
    const customer = await db.collection("user_profiles").findOne({ firebaseUid: req.uid });
    if (!shop || !customer) return res.status(404).json({ error: "Shop or customer profile not found" });
    if (!shop.location || !customer.location || distanceInMeters(shop.location, customer.location) > 1000) {
      return res.status(403).json({ error: "New Baki requests are limited to shops within 1 km. If the shopkeeper registered you, use phone verification to join." });
    }
    const { nidNumber, nidFrontUrl, nidBackUrl } = req.body;
    if (!nidNumber?.trim() || !nidFrontUrl || !nidBackUrl) {
      return res.status(400).json({ error: "NID number and both NID photos are required before requesting Baki." });
    }

    const subscription = await getEffectiveSubscription(db, shop.ownerId);
    if (subscription.planId === "basic") {
      const memberCount = await db.collection("baki_members").countDocuments({ shopId });
      if (memberCount >= 20) {
        return res.status(403).json({
          error: "This shop has reached the Basic plan limit of 20 Baki members.",
        });
      }
    }

    const existing = await db
      .collection("baki_members")
      .findOne({ shopId, customerId: req.uid });
    if (existing) {
      return res.status(400).json({ error: "Already requested or member" });
    }

    await db.collection("baki_members").insertOne({
      shopId,
      customerId: req.uid,
      memberCode: await createMemberCode(db, shopId),
      customerName: customer?.name,
      customerPhone: customer?.phoneNumber,
      customerEmail: customer?.email,
      customerAddress: customer?.address,
      nidNumber: nidNumber.trim(),
      nidFrontUrl,
      nidBackUrl,
      balance: 0,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyBaki(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const records = await db
      .collection("baki_members")
      .find({ customerId: req.uid })
      .toArray();

    // Enrich with shop names
    const enriched = await Promise.all(
      records.map(async (r) => {
        const member = await ensureMemberCode(db, r);
        const customer = member.customerId
          ? await db.collection("user_profiles").findOne({ firebaseUid: member.customerId })
          : null;
        const shop = await db
          .collection("shops")
          .findOne({ _id: new ObjectId(r.shopId) });
        const transactions = await db
          .collection("baki_transactions")
          .find({ bakiId: r._id })
          .sort({ createdAt: -1 })
          .toArray();
        return {
          ...member,
          customerName: member.customerName || customer?.name,
          customerPhone: member.customerPhone || customer?.phoneNumber,
          customerEmail: member.customerEmail || customer?.email,
          customerAddress: member.customerAddress || customer?.address,
          shopName: shop?.name,
          transactions,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getShopBaki(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const members = await db
      .collection("baki_members")
      .find({ shopId: shop._id.toString() })
      .sort({ createdAt: -1 })
      .toArray();
    const enriched = await Promise.all(members.map(async (rawMember) => {
      const member = await ensureMemberCode(db, rawMember);
      const customer = member.customerId
        ? await db.collection("user_profiles").findOne({ firebaseUid: member.customerId })
        : null;
      return {
      ...member,
      customerName: member.customerName || customer?.name,
      customerPhone: member.customerPhone || customer?.phoneNumber,
      customerEmail: member.customerEmail || customer?.email,
      customerAddress: member.customerAddress || customer?.address,
      transactions: await db.collection("baki_transactions")
        .find({ bakiId: member._id })
        .sort({ createdAt: -1 })
        .toArray(),
      };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }

}

export async function getNearbyCustomers(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop?.location) return res.status(400).json({ error: "Shop location is not set" });
    const customers = await db.collection("user_profiles").find({
      role: "customer",
      location: { $near: { $geometry: shop.location, $maxDistance: 1000 } },
    }).project({ firebaseUid: 1, name: 1, phoneNumber: 1, address: 1, latitude: 1, longitude: 1 }).toArray();
    const existing = await db.collection("baki_members").find({ shopId: shop._id.toString() }).project({ customerId: 1 }).toArray();
    const memberIds = new Set(existing.map((member) => member.customerId));
    res.json(customers.filter((customer) => !memberIds.has(customer.firebaseUid)));
  } catch (err) {
    res.status(500).json({ error: "Failed to load nearby customers" });
  }
}

export async function addBakiMember(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const { customerPhone, customerName, customerId } = req.body;

    const subscription = await getEffectiveSubscription(db, req.uid!);
    if (subscription.planId === "basic") {
      const memberCount = await db.collection("baki_members").countDocuments({
        shopId: shop._id.toString(),
      });
      if (memberCount >= 20) {
        return res.status(403).json({
          error: "Basic plan allows up to 20 Baki members. Upgrade to Premium for more.",
        });
      }

    }

    // Find customer by phone
    const customer = await db
      .collection("user_profiles")
      .findOne(customerId ? { firebaseUid: customerId } : { phoneNumber: customerPhone });
    if (!customer) return res.status(404).json({ error: "Customer not found" });
    await db.collection("baki_members").insertOne({
      shopId: shop._id.toString(),
      customerId: customer.firebaseUid,
      memberCode: await createMemberCode(db, shop._id.toString()),
      customerName: customerName || customer.name,
      customerPhone: customerPhone || customer.phoneNumber,
      customerEmail: customer.email,
      customerAddress: customer.address,
      balance: 0,
      status: "approved",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function addCreditCustomer(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const { name, phoneNumber, email, address, nidNumber, nidFrontUrl, nidBackUrl, creditLimit } = req.body;
    if (!name?.trim() || !phoneNumber?.trim() || !email?.trim() || !address?.trim() || !nidNumber?.trim() || !nidFrontUrl || !nidBackUrl) {
      return res.status(400).json({ error: "Name, phone, email, address, NID number, and both NID photos are required" });
    }

    const limit = Number(creditLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res.status(400).json({ error: "A valid credit limit is required" });
    }
    const duplicate = await db.collection("baki_members").findOne({
      shopId: shop._id.toString(),
      $or: [{ customerPhone: phoneNumber.trim() }, ...(nidNumber?.trim() ? [{ nidNumber: nidNumber.trim() }] : [])],
    });
    if (duplicate) return res.status(409).json({ error: "A credit member with this phone or NID already exists." });
    const subscription = await getEffectiveSubscription(db, req.uid!);
    if (subscription.planId === "basic" && await db.collection("baki_members").countDocuments({ shopId: shop._id.toString() }) >= 20) {
      return res.status(403).json({ error: "Basic plan allows up to 20 Baki members." });
    }
    const result = await db.collection("baki_members").insertOne({
      shopId: shop._id.toString(),
      memberCode: await createMemberCode(db, shop._id.toString()),
      customerName: name.trim(),
      customerPhone: phoneNumber.trim(),
      customerEmail: email?.trim(),
      customerAddress: address?.trim(),
      nidNumber: nidNumber?.trim(),
      nidFrontUrl,
      nidBackUrl,
      creditLimit: limit,
      balance: 0,
      status: "approved",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.json({ success: true, memberId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function joinCreditCustomer(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { shopId, phoneNumber } = req.body;
    if (!shopId || !phoneNumber?.trim()) {
      return res.status(400).json({ error: "Shop and phone number are required" });
    }
    const customer = await db.collection("user_profiles").findOne({ firebaseUid: req.uid });
    if (!customer) return res.status(404).json({ error: "Customer profile not found" });
    if (!customer.phoneNumber || customer.phoneNumber.trim() !== phoneNumber.trim()) {
      return res.status(403).json({ error: "Use the phone number saved on your customer account." });
    }
    const member = await db.collection("baki_members").findOne({
      shopId,
      customerPhone: phoneNumber.trim(),
      $or: [{ customerId: { $exists: false } }, { customerId: null }],
      status: "approved",
    });
    if (!member) return res.status(404).json({ error: "No approved credit customer was found for this phone number at that shop." });
    const existing = await db.collection("baki_members").findOne({
      shopId,
      customerId: req.uid,
      _id: { $ne: member._id },
    });
    if (existing) return res.status(409).json({ error: "You are already linked to this shop." });
    await db.collection("baki_members").updateOne(
      { _id: member._id },
      {
        $set: {
          customerId: req.uid,
          customerName: customer.name || member.customerName,
          customerEmail: customer.email || member.customerEmail,
          customerAddress: customer.address || member.customerAddress,
          updatedAt: new Date(),
        },
      }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to join the shop credit account" });
  }
}

export async function approveBaki(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { id } = req.params;

    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const member = await db.collection("baki_members").findOne({
      _id: new ObjectId(id),
      shopId: shop._id.toString(),
      status: "pending",
    });
    if (!member || !member.nidNumber || !member.nidFrontUrl || !member.nidBackUrl) {
      return res.status(400).json({ error: "Customer NID details and both photos are required before approval." });
    }
    await db.collection("baki_members").updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "approved", updatedAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBakiBalance(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { id } = req.params;
    const { amount, productDetails } = req.body;
    const purchaseAmount = Number(amount);
    if (!productDetails?.trim() || !Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      return res.status(400).json({ error: "Product details and a valid amount are required" });
    }
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const current = await db.collection("baki_members").findOne({
      _id: new ObjectId(id),
      shopId: shop._id.toString(),
      status: "approved",
    });
    if (!current) return res.status(404).json({ error: "Baki member not found" });
    const creditLimit = Number(current.creditLimit);
    if (Number.isFinite(creditLimit) && current.balance + purchaseAmount > creditLimit) {
      return res.status(400).json({
        error: `This purchase exceeds the customer's credit limit of ৳${creditLimit}. Available credit: ৳${Math.max(0, creditLimit - current.balance)}.`,
      });
    }
    const member = await db.collection("baki_members").findOneAndUpdate(
      {
        _id: new ObjectId(id),
        shopId: shop._id.toString(),
        status: "approved",
        $or: [
          { creditLimit: { $exists: false } },
          { $expr: { $lte: [{ $add: ["$balance", purchaseAmount] }, "$creditLimit"] } },
        ],
      },
      { $inc: { balance: purchaseAmount }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!member) return res.status(404).json({ error: "Baki member not found" });
    await db.collection("baki_transactions").insertOne({
      bakiId: member._id,
      shopId: shop._id.toString(),
      customerId: member.customerId,
      productDetails: productDetails.trim(),
      amount: purchaseAmount,
      balanceAfter: member.balance,
      createdAt: new Date(),
    });
    res.json({ success: true, member });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBakiCreditLimit(req: AuthRequest, res: Response) {
  try {
    const limit = Number(req.body.creditLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      return res.status(400).json({ error: "Credit limit must be zero or greater" });
    }

    const db = getDB();
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const member = await db.collection("baki_members").findOneAndUpdate(
      { _id: new ObjectId(req.params.id), shopId: shop._id.toString(), status: "approved" },
      { $set: { creditLimit: limit, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!member) return res.status(404).json({ error: "Baki member not found" });
    res.json({ success: true, member });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }

}

export async function removeBakiMember(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db.collection("shops").findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    const member = await db.collection("baki_members").findOne({
      _id: new ObjectId(req.params.id),
      shopId: shop._id.toString(),
    });
    if (!member) return res.status(404).json({ error: "Baki member not found" });
    await db.collection("baki_members").deleteOne({ _id: member._id });
    await db.collection("baki_transactions").deleteMany({ bakiId: member._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
