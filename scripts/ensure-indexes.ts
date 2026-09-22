import "dotenv/config";
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error("MONGODB_URI is required");
}

const client = new MongoClient(uri);

async function ensureIndexes() {
  await client.connect();
  const db = client.db("parar-dokan");

  await Promise.all([
    db.collection("shops").createIndex({ location: "2dsphere" }),
    db.collection("user_profiles").createIndex({ location: "2dsphere" }),
    db.collection("shops").createIndex({ ownerId: 1 }),
    db.collection("baki_members").createIndex(
      { shopId: 1, customerId: 1 },
      { unique: true }
    ),
    db.collection("orders").createIndex({ customerId: 1 }),
    db.collection("orders").createIndex({ shopId: 1 }),
    db.collection("payments").createIndex({ customerId: 1 }),
    db.collection("payments").createIndex({ shopId: 1 }),
    db.collection("sales").createIndex({ shopId: 1 }),
  ]);

  console.log("Indexes ensured");
  await client.close();
}

ensureIndexes().catch((error) => {
  console.error("Failed to ensure indexes", error);
  process.exitCode = 1;
});
