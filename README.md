# Parar Dokan 🏪

**Your Neighborhood, Connected** — A local neighborhood commerce platform connecting customers with nearby shopkeepers across Bangladesh.

---

## 🗂️ Project Structure

```

├── backend/          # Express + TypeScript + MongoDB API
│   ├── src/
│   │   ├── config/       # MongoDB & Firebase Admin setup
│   │   ├── controllers/  # Route handlers
│   │   ├── middleware/   # Auth & role middleware
│   │   ├── routes/       # All API routes
│   │   └── index.ts      # Entry point
│   ├── .env.example
│   └── package.json
│

```

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- Firebase project with Authentication enabled
- Stripe account (optional, for payments)
- SSLCommerz merchant account (optional, for BD payments)
- ImgBB API key (for image uploads)

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Fill in your environment variables (see below)
npm install
npm run dev
```

**Backend `.env` variables:**

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `CLIENT_URL` | Frontend URL (e.g. http://localhost:5173) |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK email |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK private key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `SSLCOMMERZ_STORE_ID` | SSLCommerz store ID |
| `SSLCOMMERZ_STORE_PASS` | SSLCommerz store password |
| `SSLCOMMERZ_IS_LIVE` | `true` for production |

### 3. Firebase Setup

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** with providers: Email/Password, Google, Phone
3. For Phone auth, enable reCAPTCHA in your domain settings
4. Download **Service Account JSON** → paste fields into backend `.env`
5. Copy the **Web App Config** → paste into frontend `.env`

### 4. Frontend Setup

```bash
cd frontend
cp .env.example .env
# Fill in Firebase config + ImgBB key
npm install
npm run dev
```

**Frontend `.env` variables:**

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API URL (e.g. http://localhost:5000/api) |
| `VITE_IMGBB_API_KEY` | ImgBB API key for image uploads |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

### 5. Run Both Together (from root)

```bash
npm install       # installs concurrently
npm run install:all
npm run dev
```

---

## 🌐 Routes

### Public
| Path | Description |
|---|---|
| `/` | Homepage with all marketing sections |
| `/auth` | Login + Registration (tabs: Google, Email, Phone) |

### Customer Dashboard (`/customer/*`)
| Path | Description |
|---|---|
| `/customer` | Overview with stats & quick actions |
| `/customer/shops` | Nearby shops map + list |
| `/customer/order` | Place an order |
| `/customer/orders` | My orders history |
| `/customer/baki` | Baki memberships |
| `/customer/payments` | Payment history + pay baki |
| `/customer/profile` | Profile management |

### Shopkeeper Dashboard (`/shopkeeper/*`)
| Path | Description |
|---|---|
| `/shopkeeper` | Overview with shop status toggle |
| `/shopkeeper/sales` | Add & view sales records |
| `/shopkeeper/orders` | Incoming orders management |
| `/shopkeeper/baki` | Baki customer management |
| `/shopkeeper/payments` | Payment verification |
| `/shopkeeper/profile` | Profile + shop status + subscriptions |

---

## 🔌 API Endpoints

### Profile
```
GET    /api/profile/me
POST   /api/profile/setup
PATCH  /api/profile/me
```

### Shops
```
GET    /api/shops/nearby?lat=&lng=&maxDistance=
GET    /api/shops/my                (shopkeeper)
POST   /api/shops                   (shopkeeper)
PATCH  /api/shops/open-status       (shopkeeper)
```

### Orders
```
POST   /api/orders                  (customer)
GET    /api/orders/my               (customer)
GET    /api/orders                  (shopkeeper)
PATCH  /api/orders/:id/status       (shopkeeper)
```

### Sales
```
POST   /api/sales                   (shopkeeper)
GET    /api/sales                   (shopkeeper)
DELETE /api/sales/:id               (shopkeeper)
```

### Baki
```
POST   /api/baki/request            (customer)
GET    /api/baki/my                 (customer)
GET    /api/baki                    (shopkeeper)
POST   /api/baki/add-member         (shopkeeper)
PATCH  /api/baki/:id/approve        (shopkeeper)
PATCH  /api/baki/:id/balance        (shopkeeper)
```

### Payments
```
POST   /api/payments/stripe/checkout        (customer)
POST   /api/payments/sslcommerz/checkout    (customer)
POST   /api/payments/sslcommerz/success
POST   /api/payments/sslcommerz/fail
POST   /api/payments/sslcommerz/cancel
POST   /api/payments/sslcommerz/ipn
GET    /api/payments/my                     (customer)
GET    /api/payments                        (shopkeeper)
PATCH  /api/payments/:id/verify             (shopkeeper)
```

### Subscriptions
```
GET    /api/subscriptions/pricing
GET    /api/subscriptions/me                (shopkeeper)
POST   /api/subscriptions/stripe/checkout   (shopkeeper)
```

---

## 🛠️ Tech Stack

### Frontend
- **React 18** + **Vite** + **TypeScript**
- **Tailwind CSS** + **DaisyUI** for styling
- **React Router v6** for routing
- **Firebase JS SDK** for authentication
- **Axios** for API calls
- **React Leaflet** for maps
- **Framer Motion** for animations
- **Lucide React** for icons
- **Lenis** for smooth scrolling

### Backend
- **Express** + **TypeScript**
- **MongoDB** (native driver, no Mongoose)
- **Firebase Admin SDK** for token verification
- **Stripe** for card payments
- **SSLCommerz** for Bangladeshi payments
- **CORS** for cross-origin requests

### Database Collections
| Collection | Purpose |
|---|---|
| `user_profiles` | All user profiles (both roles) |
| `shops` | Shopkeeper shop data |
| `sales` | Daily sales records |
| `orders` | Customer orders |
| `baki_members` | Credit membership records |
| `payments` | Payment transactions |
| `subscriptions` | Shopkeeper subscriptions |

---

## 🔐 Security Model

1. All protected routes require a Firebase ID Token in `Authorization: Bearer <token>`
2. Backend verifies token using Firebase Admin SDK
3. User role is loaded from MongoDB and checked per endpoint
4. Roles are locked after registration — cannot be changed through the normal flow
5. Customers cannot access shopkeeper endpoints and vice versa
6. Shop ownership is verified before allowing updates

---

## 🌍 Features

- ✅ Firebase Auth (Email, Google, Phone OTP)
- ✅ Role-based dashboards (Customer / Shopkeeper)
- ✅ MongoDB geospatial nearby shop search
- ✅ Interactive Leaflet maps
- ✅ Plain-language order system
- ✅ Digital baki (credit) management with approval workflow
- ✅ Stripe & SSLCommerz payment integration
- ✅ Shop open/closed status management
- ✅ Shopkeeper subscription plans
- ✅ Image upload via ImgBB
- ✅ Dark/light theme toggle
- ✅ English/Bangla language switching
- ✅ Fully responsive (mobile, tablet, desktop)
- ✅ React Error Boundary for crash resilience

---

## 📝 License

MIT
