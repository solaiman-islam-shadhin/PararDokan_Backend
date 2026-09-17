import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI!;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db("parar-dokan");

  // Geospatial indexes
  await db.collection("shops").createIndex({ location: "2dsphere" });
  await db.collection("user_profiles").createIndex({ location: "2dsphere" });

  // Other indexes
  await db.collection("shops").createIndex({ ownerId: 1 });
  await db
    .collection("baki_members")
    .createIndex({ shopId: 1, customerId: 1 }, { unique: true });
  await db.collection("orders").createIndex({ customerId: 1 });
  await db.collection("orders").createIndex({ shopId: 1 });
  await db.collection("payments").createIndex({ customerId: 1 });
  await db.collection("payments").createIndex({ shopId: 1 });
  await db.collection("sales").createIndex({ shopId: 1 });

  console.log("✅ MongoDB connected and indexes ensured");
  return db;
}

export function getDB(): Db {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}
