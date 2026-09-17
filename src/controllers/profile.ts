import { Response } from "express";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";

export async function getMyProfile(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const profile = await db
      .collection("user_profiles")
      .findOne({ firebaseUid: req.uid });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }

}

export async function getMyRole(req: AuthRequest, res: Response) {
  if (!req.userProfile) {
    return res.status(404).json({ error: "Profile not found" });
  }
  res.json({ role: req.userProfile.role });
}

export async function setupProfile(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const existing = await db
      .collection("user_profiles")
      .findOne({ firebaseUid: req.uid });

    if (existing?.roleLocked) {
      return res.status(400).json({ error: "Role already set and locked" });
    }

    const {
      name,
      email,
      image,
      role,
      address,
      phoneNumber,
      gender,
      shopName,
      latitude,
      longitude,
    } = req.body;

    const hasLocation =
      Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
    if (!hasLocation) {
      return res.status(400).json({ error: "Location is required" });
    }
    const normalizedLatitude = Number(latitude);
    const normalizedLongitude = Number(longitude);
    const location = {
      type: "Point",
      coordinates: [normalizedLongitude, normalizedLatitude],
    };

    const profileData = {
      firebaseUid: req.uid,
      name,
      email,
      image,
      role,
      address,
      phoneNumber,
      gender,
      shopName,
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      location,
      roleLocked: true,
      setupComplete: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .collection("user_profiles")
        .updateOne({ firebaseUid: req.uid }, { $set: profileData });
    } else {
      await db.collection("user_profiles").insertOne(profileData);
    }

    // Create shop if shopkeeper
    if (role === "shopkeeper" && shopName) {
      const existingShop = await db
        .collection("shops")
        .findOne({ ownerId: req.uid });
      if (!existingShop) {
        await db.collection("shops").insertOne({
          ownerId: req.uid,
          name: shopName,
          address,
          location,
          isOpen: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

    }

    res.json({ success: true, message: "Profile setup complete" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateProfileLocation(req: AuthRequest, res: Response) {
  try {
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: "A valid latitude and longitude are required" });
    }
    const db = getDB();
    const location = { type: "Point", coordinates: [longitude, latitude] };
    await db.collection("user_profiles").updateOne(
      { firebaseUid: req.uid },
      { $set: { latitude, longitude, location, updatedAt: new Date() } }
    );
    if (req.userProfile?.role === "shopkeeper") {
      await db.collection("shops").updateOne(
        { ownerId: req.uid },
        { $set: { latitude, longitude, location, updatedAt: new Date() } }
      );
    }
    res.json({ success: true, latitude, longitude });
  } catch (err) {
    res.status(500).json({ error: "Failed to update location" });
  }
}

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const allowed = ["name", "image", "address", "phoneNumber", "gender"];
    const updates: Record<string, any> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    updates.updatedAt = new Date();

    await db
      .collection("user_profiles")
      .updateOne({ firebaseUid: req.uid }, { $set: updates });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
