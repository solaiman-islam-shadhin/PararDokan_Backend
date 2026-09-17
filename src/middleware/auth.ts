import { Request, Response, NextFunction } from "express";
import admin from "../config/firebase";
import { getDB } from "../config/database";

export interface AuthRequest extends Request {
  uid?: string;
  userProfile?: any;
}

export async function verifyToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Empty bearer token" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;

    const db = getDB();
    const profile = await db
      .collection("user_profiles")
      .findOne({ firebaseUid: decoded.uid });
    req.userProfile = profile;

    next();
  } catch (err: any) {
    console.error("Firebase token verification failed:", {
      code: err?.code,
      message: err?.message,
    });
    return res.status(401).json({
      error: "Invalid token",
      code: err?.code || "unknown",
    });
  }
}

export function requireRole(role: "customer" | "shopkeeper") {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userProfile) {
      return res.status(403).json({ error: "Profile not found" });
    }
    if (req.userProfile.role !== role) {
      return res
        .status(403)
        .json({ error: `Only ${role}s can access this resource` });
    }
    next();
  };
}
