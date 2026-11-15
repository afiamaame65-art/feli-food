const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");
const { Resend } = require("resend");
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth")
const { getMessaging } = require("firebase-admin/messaging");;
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const serviceAccount = require("./feli-food-firebase-adminsdk-fbsvc-6af07a7986.json");
const crypto = require("crypto");

dotenv.config();

initializeApp({
  credential: cert(serviceAccount)
});

const adminDb = getFirestore();
const adminAuth = getAuth();
const adminMessaging = getMessaging();
// VERIFY FELI FOOD ADMIN
async function requireFeliAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!idToken) {
    return res.status(401).json({
      success: false,
      message: "Admin login required."
    });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(idToken);

    if (
      (decoded.email || "").toLowerCase() !== "loddyfx58@gmail.com" ||
      decoded.email_verified !== true
    ) {
      return res.status(403).json({
        success: false,
        message: "Admin access denied."
      });
    }

    req.feliAdmin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid login session."
    });
  }
}
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
const otpStore = new Map();

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send("Feli Food Paystack Server is running ✅");
});

// SEND EMAIL OTP
app.post("/api/auth/send-email-otp", async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ status: false, message: "Email is required" });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + (30 * 60 * 1000);

    otpStore.set(email.trim().toLowerCase(), {
      otp,
      role: role || "customer",
      expiresAt
    });

    const emailResponse = await resend.emails.send({
      from: "Feli Food <otp@felifoodgh.com>",
      to: [email],
      subject: "Your Feli Food Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
          <h2 style="color: #ff5a00;">Feli Food</h2>
          <p>Please use the one-time-password (OTP) below:</p>
          <h1 style="letter-spacing: 8px; color: #222;">${otp}</h1>
          <p>The OTP will expire in <strong>30 minutes</strong>.</p>
          <p>If you did not request this code, you can ignore this email.</p>
        </div>
      `
    });

    if (emailResponse.error) {
      console.error("Resend error:", emailResponse.error);
      return res.status(500).json({ status: false, message: "Could not send OTP email" });
    }

    res.json({ status: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("OTP email error:", error);
    res.status(500).json({ status: false, message: "Could not send OTP email" });
  }
});

// VERIFY EMAIL OTP
app.post("/api/auth/verify-email-otp", async (req, res) => {
  try {
    const { email, role, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ status: false, message: "Email and OTP are required" });
    }

    const otpKey = email.trim().toLowerCase();
    const savedOTP = otpStore.get(otpKey);

    if (!savedOTP) {
      return res.status(400).json({ status: false, message: "OTP not found. Please request a new OTP." });
    }

    if ((savedOTP.role || "customer") !== (role || "customer")) {
      return res.status(400).json({ status: false, message: "OTP role mismatch. Please request a new code." });
    }

    if (Date.now() > savedOTP.expiresAt) {
      otpStore.delete(otpKey);
      return res.status(400).json({ status: false, message: "OTP has expired. Please request a new OTP." });
    }

    if (String(otp) !== String(savedOTP.otp)) {
      return res.status(400).json({ status: false, message: "Invalid OTP. Please try again." });
    }

    otpStore.delete(otpKey);
    res.json({ status: true, message: "Email verified successfully" });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ status: false, message: "Could not verify OTP" });
  }
});

app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const { email, amount, subaccount } = req.body;

    if (!email || !amount) {
      return res.status(400).json({ status: false, message: "Email and amount are required" });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: String(Math.round(Number(amount) * 100)),
        currency: "GHS",
        subaccount
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Paystack error:", error.response?.data || error.message);
    res.status(500).json({ status: false, message: "Unable to initialize payment" });
  }
});

app.post("/api/paystack/subaccount", async (req, res) => {
  try {
    const { businessName, bankName, accountNumber, accountName, email, phone } = req.body;

    if (!businessName || !bankName || !accountNumber || !accountName) {
      return res.status(400).json({ status: false, message: "Restaurant and bank details are required" });
    }

    const headers = {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    };

    const banksResponse = await axios.get(
      "https://api.paystack.co/bank?country=ghana&currency=GHS&perPage=100",
      { headers }
    );

    const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const requestedBank = normalize(bankName);
    const bank = banksResponse.data.data.find(
      (item) => normalize(item.name) === requestedBank || normalize(item.slug) === requestedBank
    );

    if (!bank) {
      return res.status(400).json({
        status: false,
        message: "Bank not found. Please enter the bank name exactly as Paystack lists it."
      });
    }

    const accountResponse = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`,
      { headers }
    );

    if (!accountResponse.data.status) {
      return res.status(400).json({ status: false, message: "Could not verify this bank account." });
    }

    const resolvedAccountName = accountResponse.data.data.account_name;
    const subaccountResponse = await axios.post(
      "https://api.paystack.co/subaccount",
      {
        business_name: businessName,
        bank_code: bank.code,
        account_number: accountNumber,
        percentage_charge: 5,
        primary_contact_name: accountName,
        primary_contact_email: email,
        primary_contact_phone: phone
      },
      { headers }
    );

    res.json({
      status: true,
      message: "Restaurant Paystack subaccount created",
      data: {
        subaccountCode: subaccountResponse.data.data.subaccount_code,
        accountName: resolvedAccountName,
        bankName: bank.name,
        percentageCharge: 5
      }
    });
  } catch (error) {
    console.error("Paystack subaccount error:", error.response?.data || error.message);
    res.status(500).json({
      status: false,
      message: error.response?.data?.message || "Could not create restaurant Paystack subaccount"
    });
  }
});

app.get("/api/paystack/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    if (!reference) {
      return res.status(400).json({ status: false, message: "Transaction reference is required" });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );

    res.json(response.data);
  } catch (error) {
    console.error("Paystack verification error:", error.response?.data || error.message);
    res.status(500).json({ status: false, message: "Could not verify payment" });
  }
});

app.post("/api/orders/next-number", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";

    if (!idToken) {
      return res.status(401).json({ status: false, message: "Login required" });
    }

    await adminAuth.verifyIdToken(idToken);
    const restaurantId = req.body.restaurantId;

    if (!restaurantId || typeof restaurantId !== "string") {
      return res.status(400).json({ status: false, message: "Restaurant ID is required" });
    }

    const globalRef = adminDb.collection("orderCounters").doc("global");
    const restaurantRef = adminDb.collection("orderCounters").doc(`restaurant_${restaurantId}`);

    const numbers = await adminDb.runTransaction(async (transaction) => {
      const globalSnap = await transaction.get(globalRef);
      const restaurantSnap = await transaction.get(restaurantRef);
      let globalMax = globalSnap.exists ? Number(globalSnap.data().lastOrderNumber) || 0 : 0;
      let restaurantMax = restaurantSnap.exists ? Number(restaurantSnap.data().lastOrderNumber) || 0 : 0;

      if (!globalSnap.exists || !restaurantSnap.exists) {
        const oldOrders = await transaction.get(adminDb.collection("orders"));
        let oldRestaurantOrders = 0;

        oldOrders.forEach((orderDoc) => {
          const data = orderDoc.data();
          if (!globalSnap.exists) {
            const number = Number(data.orderNumber);
            if (Number.isFinite(number)) globalMax = Math.max(globalMax, number);
          }
          if (!restaurantSnap.exists && data.restaurantId === restaurantId) {
            const number = Number(data.restaurantOrderNumber);
            if (Number.isFinite(number)) restaurantMax = Math.max(restaurantMax, number);
            else oldRestaurantOrders++;
          }
        });

        restaurantMax = Math.max(restaurantMax, oldRestaurantOrders);
      }

      const nextOrderNumber = globalMax + 1;
      const nextRestaurantOrderNumber = restaurantMax + 1;
      transaction.set(globalRef, { lastOrderNumber: nextOrderNumber }, { merge: true });
      transaction.set(restaurantRef, { lastOrderNumber: nextRestaurantOrderNumber }, { merge: true });
      return { orderNumber: nextOrderNumber, restaurantOrderNumber: nextRestaurantOrderNumber };
    });

    return res.json({ status: true, ...numbers });
  } catch (error) {
    console.error("Order number error:", error);
    return res.status(500).json({ status: false, message: "Could not generate order numbers" });
  }
});

// ---------- FELI FOOD DELIVERY VERIFICATION ----------
// Delivery codes are stored separately from public order documents. Only a hash
// is stored; the plaintext code is returned once to the authenticated customer.
app.post("/api/delivery/create-code", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!idToken) {
      return res.status(401).json({ success: false, message: "Please sign in again." });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const { orderId } = req.body || {};

    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({ success: false, message: "Order ID is required." });
    }

    const orderRef = adminDb.collection("orders").doc(orderId);
    const codeRef = adminDb.collection("deliveryVerifications").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const order = orderSnap.data();
    if (order.customerId !== decoded.uid) {
      return res.status(403).json({ success: false, message: "You do not own this order." });
    }

    if (order.status === "Delivered" || order.deliveryStatus === "Delivered") {
      return res.status(409).json({ success: false, message: "This order is already delivered." });
    }

    const existingCode = await codeRef.get();
    if (existingCode.exists) {
      return res.status(409).json({
        success: false,
        message: "A delivery code already exists for this order. Keep the code shown on your order page."
      });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const codeHash = crypto.createHash("sha256").update(salt + code).digest("hex");

    await codeRef.create({
      orderId,
      customerUid: decoded.uid,
      codeHash,
      salt,
      attempts: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      used: false
    });

    return res.json({ success: true, code });
  } catch (error) {
    console.error("Delivery code creation error:", error);
    return res.status(500).json({ success: false, message: "Could not create the delivery code." });
  }
});

// RECOVER A LOST DELIVERY CODE
app.post("/api/delivery/recover-code", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "Please sign in again."
      });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const { orderId } = req.body || {};

    if (!orderId || typeof orderId !== "string") {
      return res.status(400).json({
        success: false,
        message: "Order ID is required."
      });
    }

    const orderRef = adminDb.collection("orders").doc(orderId);
    const codeRef = adminDb.collection("deliveryVerifications").doc(orderId);

    const code = String(crypto.randomInt(100000, 1000000));
    const salt = crypto.randomBytes(16).toString("hex");
    const codeHash = crypto
      .createHash("sha256")
      .update(salt + code)
      .digest("hex");

    await adminDb.runTransaction(async (transaction) => {
      const [orderSnap, codeSnap] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(codeRef)
      ]);

      if (!orderSnap.exists) {
        throw new Error("Order not found.");
      }

      const order = orderSnap.data();

      if (order.customerId !== decoded.uid) {
        throw new Error("You do not own this order.");
      }

      if (
        order.status === "Delivered" ||
        order.deliveryStatus === "Delivered"
      ) {
        throw new Error("This order is already delivered.");
      }

      if (!codeSnap.exists) {
        throw new Error(
          "No delivery code exists for this order. Contact Feli Food support."
        );
      }

      const existing = codeSnap.data();
      const lastRecoveryMillis = existing.lastRecoveryAt?.toDate
        ? existing.lastRecoveryAt.toDate().getTime()
        : 0;

      if (
        lastRecoveryMillis &&
        Date.now() - lastRecoveryMillis < 30000
      ) {
        throw new Error(
          "Please wait 30 seconds before recovering the code again."
        );
      }

      transaction.set(codeRef, {
        orderId,
        customerUid: decoded.uid,
        codeHash,
        salt,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastRecoveryAt: FieldValue.serverTimestamp(),
        used: false
      });
    });

    return res.json({
      success: true,
      code,
      message: "Recovered. The previous code is now invalid."
    });

  } catch (error) {
    console.error("Delivery code recovery error:", error);

    const message = error.message ||
      "Could not recover the delivery code.";

    const clientError =
      /not found|not own|already delivered|wait 30|no delivery code/i
        .test(message);

    return res.status(clientError ? 400 : 500).json({
      success: false,
      message
    });
  }
});
// END RECOVER DELIVERY CODE

app.post("/api/delivery/verify-code", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!idToken) {
      return res.status(401).json({ success: false, message: "Please sign in again." });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const { orderId, code } = req.body || {};

    if (!orderId || typeof orderId !== "string" || !/^\d{6}$/.test(String(code || ""))) {
      return res.status(400).json({ success: false, message: "Enter the order ID and a valid six-digit code." });
    }

    const orderRef = adminDb.collection("orders").doc(orderId);
    const riderRef = adminDb.collection("riders").doc(decoded.uid);
    const codeRef = adminDb.collection("deliveryVerifications").doc(orderId);

    const verificationResult = await adminDb.runTransaction(async (transaction) => {
      const [orderSnap, riderSnap, codeSnap] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(riderRef),
        transaction.get(codeRef)
      ]);

      if (!orderSnap.exists) throw new Error("Order not found.");
      if (!riderSnap.exists || riderSnap.data().status !== "Approved") {
        throw new Error("Your rider account is not approved.");
      }

      const order = orderSnap.data();
      if (order.riderId !== decoded.uid) throw new Error("This delivery is not assigned to you.");
      if (order.deliveryStatus !== "Accepted") throw new Error("This order is not awaiting delivery completion.");
      if (!codeSnap.exists) throw new Error("Delivery code not found. Ask the customer to contact Feli Food support.");

      const saved = codeSnap.data();
      if (saved.used) throw new Error("This delivery code has already been used.");
      const expiryMillis = saved.expiresAt?.toDate
        ? saved.expiresAt.toDate().getTime()
        : new Date(saved.expiresAt).getTime();
      if (!Number.isFinite(expiryMillis) || expiryMillis < Date.now()) {
        throw new Error("This delivery code has expired.");
      }
      if (Number(saved.attempts || 0) >= 5) {
        throw new Error("Too many incorrect attempts. Contact Feli Food support.");
      }

      const submittedHash = crypto.createHash("sha256").update(saved.salt + String(code)).digest("hex");
      const expected = Buffer.from(saved.codeHash, "hex");
      const actual = Buffer.from(submittedHash, "hex");
      const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

      if (!matches) {
        transaction.update(codeRef, { attempts: FieldValue.increment(1) });
        return { incorrect: true };
      }

      transaction.update(orderRef, {
        deliveryStatus: "Delivered",
        status: "Delivered",
        deliveredAt: FieldValue.serverTimestamp()
      });
      transaction.delete(codeRef);
      return { incorrect: false };
    });

    if (verificationResult.incorrect) {
      return res.status(400).json({ success: false, message: "Incorrect code. Please check with the customer." });
    }

    return res.json({ success: true, message: "Delivery verified and marked as delivered." });
  } catch (error) {
    console.error("Delivery code verification error:", error);
    const message = error.message || "Could not verify delivery.";
    const clientError = /not found|not assigned|not approved|not awaiting|incorrect|expired|already|too many|contact/i.test(message);
    return res.status(clientError ? 400 : 500).json({ success: false, message });
  }
});
// ---------- END DELIVERY VERIFICATION ----------
// ==========================================

// ==========================================
// NEW RESTAURANT REGISTRATION ALERTS
// ==========================================

app.post("/api/restaurants/registration-notification", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "Restaurant owner login required."
      });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const restaurantId = req.body?.restaurantId;

    if (typeof restaurantId !== "string" || !restaurantId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Restaurant ID is required."
      });
    }

    const restaurantRef = adminDb.collection("restaurants").doc(restaurantId.trim());
    const restaurantSnapshot = await restaurantRef.get();

    if (!restaurantSnapshot.exists) {
      return res.status(404).json({
        success: false,
        message: "Restaurant application was not found."
      });
    }

    const restaurant = restaurantSnapshot.data();

    // Confirm that the logged-in user owns this pending application.
    if (
      !restaurant.ownerUid ||
      restaurant.ownerUid !== decoded.uid ||
      restaurant.status !== "Pending Approval"
    ) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to submit this restaurant alert."
      });
    }

    const notificationRef = adminDb
      .collection("adminNotifications")
      .doc(`restaurant_${restaurantSnapshot.id}`);

    const existingNotification = await notificationRef.get();

    if (!existingNotification.exists) {
      await notificationRef.set({
        type: "restaurant_registration",
        title: "New restaurant application",
        message: `${restaurant.name || "A restaurant"} has submitted a registration application.`,
        restaurantId: restaurantSnapshot.id,
        restaurantName: restaurant.name || "Unnamed restaurant",
        ownerName: restaurant.owner || "Not provided",
        ownerEmail: decoded.email || "Not provided",
        phone: restaurant.phone || "Not provided",
        location: restaurant.location || "Not provided",
        status: "Pending Approval",
        read: false,
        emailSent: false,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    const latestNotification = await notificationRef.get();
    const notificationData = latestNotification.data() || {};

    // Retry email if a previous attempt did not complete.
    if (notificationData.emailSent !== true) {
      if (!process.env.RESEND_API_KEY) {
        console.error("RESEND_API_KEY is missing.");
        return res.status(200).json({
          success: true,
          notificationCreated: true,
          emailSent: false,
          message: "Dashboard alert saved; email service is not configured."
        });
      }

      const escapeEmailHtml = (value) =>
        String(value ?? "Not provided").replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "\"": "&quot;",
          "'": "&#39;"
        }[char]));

      const emailResult = await resend.emails.send({
        from: "Feli Food <otp@felifoodgh.com>",
        to: ["loddyfx58@gmail.com"],
        subject: `New restaurant application: ${String(restaurant.name || "Unnamed restaurant").slice(0, 120)}`,
        html: `
          <h2>New Feli Food Restaurant Application</h2>
          <p>A restaurant has submitted an application and is waiting for your approval.</p>
          <p><strong>Restaurant:</strong> ${escapeEmailHtml(restaurant.name)}</p>
          <p><strong>Owner:</strong> ${escapeEmailHtml(restaurant.owner)}</p>
          <p><strong>Owner email:</strong> ${escapeEmailHtml(decoded.email)}</p>
          <p><strong>Phone:</strong> ${escapeEmailHtml(restaurant.phone)}</p>
          <p><strong>Location:</strong> ${escapeEmailHtml(restaurant.location)}</p>
          <p><strong>Status:</strong> Pending Approval</p>
          <p>Sign in to the Feli Food Admin Dashboard to review this application.</p>
        `
      });

      if (emailResult?.error) {
        console.error("Restaurant application email failed:", emailResult.error);
        return res.status(200).json({
          success: true,
          notificationCreated: true,
          emailSent: false,
          message: "Dashboard alert saved; admin email could not be sent."
        });
      }

      await notificationRef.set({
        emailSent: true,
        emailSentAt: FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return res.json({
      success: true,
      notificationCreated: true,
      emailSent: true,
      message: "Restaurant application alert submitted."
    });

  } catch (error) {
    console.error("Restaurant registration notification error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not submit the restaurant registration alert."
    });
  }
});

// FELI FOOD ADMIN PUSH NOTIFICATIONS
// ==========================================

app.post(
  "/api/admin/notifications/send",
  requireFeliAdmin,
  async (req, res) => {
    try {
      const { title, body } = req.body || {};

      if (
        typeof title !== "string" ||
        typeof body !== "string" ||
        !title.trim() ||
        !body.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: "Notification title and message are required."
        });
      }

      // Get subscribed customer tokens
      const tokensSnapshot = await adminDb
        .collection("fcmTokens")
        .get();

      if (tokensSnapshot.empty) {
        return res.json({
          success: true,
          message: "No subscribed customers found.",
          sent: 0,
          failed: 0
        });
      }

      const subscriptions = [];

      tokensSnapshot.forEach((doc) => {
        const data = doc.data();

        if (
          typeof data.customerId === "string" &&
          typeof data.token === "string" &&
          data.token.trim()
        ) {
          subscriptions.push({
            ref: doc.ref,
            token: data.token
          });
        }
      });

      if (subscriptions.length === 0) {
        return res.json({
          success: true,
          message: "No valid customer subscriptions found.",
          sent: 0,
          failed: 0
        });
      }

      let sent = 0;
      let failed = 0;
      let removed = 0;

      // Firebase supports up to 500 tokens per batch
      for (let i = 0; i < subscriptions.length; i += 500) {
        const batch = subscriptions.slice(i, i + 500);

        const response =
          await adminMessaging.sendEachForMulticast({
            tokens: batch.map(item => item.token),

            notification: {
              title: title.trim(),
              body: body.trim()
            }
          });

        sent += response.successCount;
        failed += response.failureCount;

        // Remove expired or invalid tokens
        const deletions = [];

        response.responses.forEach((result, index) => {
          if (
            !result.success &&
            (
              result.error?.code ===
                "messaging/registration-token-not-registered" ||
              result.error?.code ===
                "messaging/invalid-registration-token"
            )
          ) {
            deletions.push(batch[index].ref.delete());
            removed++;
          }
        });

        await Promise.all(deletions);
      }

      return res.json({
        success: true,
        message: "Push notification processing completed.",
        total: subscriptions.length,
        sent,
        failed,
        removed
      });

    } catch (error) {
      console.error("Admin push notification error:", error);

      return res.status(500).json({
        success: false,
        message: "Could not send push notifications."
      });
    }
  }
);

// END FELI FOOD ADMIN PUSH NOTIFICATIONS

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Feli Food server running on port ${PORT}`);
});
