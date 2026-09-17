import admin from "firebase-admin";

const cleanEnvValue = (value?: string) =>
  value?.trim().replace(/^["']|["']$/g, "");

if (!admin.apps.length) {
  const privateKey = cleanEnvValue(process.env.FIREBASE_PRIVATE_KEY)?.replace(
    /\\n/g,
    "\n"
  );

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: cleanEnvValue(process.env.FIREBASE_PROJECT_ID),
      clientEmail: cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL),
      privateKey,
    }),
  });
}

export default admin;
