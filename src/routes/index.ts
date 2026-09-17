import { Router } from "express";
import { verifyToken, requireRole } from "../middleware/auth";
import {
  getMyProfile,
  getMyRole,
  updateProfileLocation,
  setupProfile,
  updateProfile,
} from "../controllers/profile";
import {
  getNearbyShops,
  searchShops,
  getMapShops,
  getMyShop,
  getPaymentSettings,
  updatePaymentSettings,
  createShop,
  updateOpenStatus,
  updateSchedule,
} from "../controllers/shops";
import {
  createOrder,
  getMyOrders,
  getShopOrders,
  updateOrderStatus,
} from "../controllers/orders";
import { addSale, getMySales, deleteSale } from "../controllers/sales";
import {
  requestBaki,
  getMyBaki,
  getShopBaki,
  addBakiMember,
  addCreditCustomer,
  joinCreditCustomer,
  approveBaki,
  updateBakiBalance,
  updateBakiCreditLimit,
  removeBakiMember,
  getNearbyCustomers,
} from "../controllers/baki";
import {
  stripeCheckout,
  orderCheckout,
  stripeSubscriptionCheckout,
  getMyPayments,
  getShopPayments,
  verifyPayment,
  submitManualPayment,
  getMySubscription,
  getPricing,
  stripePaymentWebhook,
  stripeSubscriptionWebhook,
  confirmStripePayment,
  confirmStripeSubscription,
} from "../controllers/payments";

const router = Router();

// Health
router.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Profile ─────────────────────────────────────────────────────────────────
router.get("/profile/me", verifyToken, getMyProfile);
router.get("/profile/role", verifyToken, getMyRole);
router.patch("/profile/location", verifyToken, updateProfileLocation);
router.post("/profile/setup", verifyToken, setupProfile);
router.patch("/profile/me", verifyToken, updateProfile);

// ─── Shops ───────────────────────────────────────────────────────────────────
router.get("/shops/nearby", verifyToken, getNearbyShops);
router.get("/shops/search", verifyToken, requireRole("customer"), searchShops);
router.get("/shops/map", verifyToken, requireRole("customer"), getMapShops);
router.get(
  "/shops/my",
  verifyToken,
  requireRole("shopkeeper"),
  getMyShop
);
router.get("/shops/:id/payment-settings", verifyToken, getPaymentSettings);
router.patch(
  "/shops/payment-settings",
  verifyToken,
  requireRole("shopkeeper"),
  updatePaymentSettings
);
router.post("/shops", verifyToken, requireRole("shopkeeper"), createShop);
router.patch(
  "/shops/open-status",
  verifyToken,
  requireRole("shopkeeper"),
  updateOpenStatus
);
router.patch(
  "/shops/schedule",
  verifyToken,
  requireRole("shopkeeper"),
  updateSchedule
);

// ─── Orders ──────────────────────────────────────────────────────────────────
router.post("/orders", verifyToken, requireRole("customer"), createOrder);
router.get("/orders/my", verifyToken, requireRole("customer"), getMyOrders);
router.get(
  "/orders",
  verifyToken,
  requireRole("shopkeeper"),
  getShopOrders
);
router.patch(
  "/orders/:id/status",
  verifyToken,
  requireRole("shopkeeper"),
  updateOrderStatus
);

// ─── Sales ───────────────────────────────────────────────────────────────────
router.post("/sales", verifyToken, requireRole("shopkeeper"), addSale);
router.get("/sales", verifyToken, requireRole("shopkeeper"), getMySales);
router.delete(
  "/sales/:id",
  verifyToken,
  requireRole("shopkeeper"),
  deleteSale
);

// ─── Baki ────────────────────────────────────────────────────────────────────
router.post(
  "/baki/request",
  verifyToken,
  requireRole("customer"),
  requestBaki
);
router.get("/baki/my", verifyToken, requireRole("customer"), getMyBaki);
router.get("/baki", verifyToken, requireRole("shopkeeper"), getShopBaki);
router.get("/baki/nearby-customers", verifyToken, requireRole("shopkeeper"), getNearbyCustomers);
router.post(
  "/baki/add-member",
  verifyToken,
  requireRole("shopkeeper"),
  addBakiMember
);
router.post(
  "/baki/credit-customer",
  verifyToken,
  requireRole("shopkeeper"),
  addCreditCustomer
);
router.post(
  "/baki/join-by-phone",
  verifyToken,
  requireRole("customer"),
  joinCreditCustomer
);
router.patch(
  "/baki/:id/approve",
  verifyToken,
  requireRole("shopkeeper"),
  approveBaki
);
router.patch(
  "/baki/:id/balance",
  verifyToken,
  requireRole("shopkeeper"),
  updateBakiBalance
);
router.patch(
  "/baki/:id/credit-limit",
  verifyToken,
  requireRole("shopkeeper"),
  updateBakiCreditLimit
);
router.delete(
  "/baki/:id",
  verifyToken,
  requireRole("shopkeeper"),
  removeBakiMember
);

// ─── Payments ────────────────────────────────────────────────────────────────
router.post(
  "/payments/stripe/checkout",
  verifyToken,
  requireRole("customer"),
  stripeCheckout
);
router.post("/orders/:id/payment", verifyToken, requireRole("customer"), orderCheckout);
router.post("/payments/stripe/webhook", stripePaymentWebhook);
router.post("/subscriptions/stripe/webhook", stripeSubscriptionWebhook);
router.get("/payments/stripe/confirm", verifyToken, confirmStripePayment);
router.get("/subscriptions/stripe/confirm", verifyToken, confirmStripeSubscription);
router.get("/payments/my", verifyToken, requireRole("customer"), getMyPayments);
router.post("/payments/manual", verifyToken, requireRole("customer"), submitManualPayment);
router.get(
  "/payments",
  verifyToken,
  requireRole("shopkeeper"),
  getShopPayments
);
router.patch(
  "/payments/:id/verify",
  verifyToken,
  requireRole("shopkeeper"),
  verifyPayment
);

// ─── Subscriptions ───────────────────────────────────────────────────────────
router.get("/subscriptions/pricing", getPricing);
router.get(
  "/subscriptions/me",
  verifyToken,
  requireRole("shopkeeper"),
  getMySubscription
);
router.post(
  "/subscriptions/stripe/checkout",
  verifyToken,
  requireRole("shopkeeper"),
  stripeSubscriptionCheckout
);

export default router;
