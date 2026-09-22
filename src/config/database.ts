import { MongoClient, Db } from "mongodb";

let client: MongoClient;
let db: Db;

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI!;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db("parar-dokan");
  console.log("✅ MongoDB connected");
  return db;
}

export function getDB(): Db {
  if (!db) throw new Error("DB not initialized. Call connectDB() first.");
  return db;
}
