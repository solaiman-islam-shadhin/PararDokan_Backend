import { Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/database";
import { AuthRequest } from "../middleware/auth";

export async function addSale(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const { itemName, price, customerName, customerPhone, note } = req.body;

    const result = await db.collection("sales").insertOne({
      shopId: shop._id.toString(),
      ownerId: req.uid,
      itemName,
      price: Number(price),
      customerName,
      customerPhone,
      note,
      createdAt: new Date(),
    });

    res.json({ success: true, saleId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMySales(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const shop = await db
      .collection("shops")
      .findOne({ ownerId: req.uid });
    if (!shop) return res.status(404).json({ error: "Shop not found" });

    const sales = await db
      .collection("sales")
      .find({ shopId: shop._id.toString() })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteSale(req: AuthRequest, res: Response) {
  try {
    const db = getDB();
    const { id } = req.params;

    const sale = await db
      .collection("sales")
      .findOne({ _id: new ObjectId(id) });
    if (!sale) return res.status(404).json({ error: "Sale not found" });
    if (sale.ownerId !== req.uid) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.collection("sales").deleteOne({ _id: new ObjectId(id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}
