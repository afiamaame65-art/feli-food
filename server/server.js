const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const axios = require("axios");
dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.get("/", (req, res) => {
    res.send("Feli Food Paystack Server is running ✅");
});
app.post("/api/paystack/initialize", async (req, res) => {
  try {
    const { email, amount, subaccount } = req.body;

    if (!email || !amount) {
      return res.status(400).json({
        status: false,
        message: "Email and amount are required"
      });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email: email,
        amount: String(Math.round(Number(amount) * 100)),
        currency: "GHS",
        subaccount: subaccount
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
    console.error(
      "Paystack error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      status: false,
      message: "Unable to initialize payment"
    });
  }
});
app.post("/api/paystack/subaccount", async (req, res) => {
  try {
    const {
      businessName,
      bankName,
      accountNumber,
      accountName,
      email,
      phone
    } = req.body;

    if (
      !businessName ||
      !bankName ||
      !accountNumber ||
      !accountName
    ) {
      return res.status(400).json({
        status: false,
        message: "Restaurant and bank details are required"
      });
    }

    const headers = {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
    };

    // Get Ghana banks from Paystack
    const banksResponse = await axios.get(
      "https://api.paystack.co/bank?country=ghana&currency=GHS&perPage=100",
      { headers }
    );

    const normalize = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

    const requestedBank = normalize(bankName);

    const bank = banksResponse.data.data.find(
      (item) =>
        normalize(item.name) === requestedBank ||
        normalize(item.slug) === requestedBank
    );

    if (!bank) {
      return res.status(400).json({
        status: false,
        message: "Bank not found. Please enter the bank name exactly as Paystack lists it."
      });
    }

    // Verify the bank account
    const accountResponse = await axios.get(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`,
      { headers }
    );

    if (!accountResponse.data.status) {
      return res.status(400).json({
        status: false,
        message: "Could not verify this bank account."
      });
    }

    const resolvedAccountName =
      accountResponse.data.data.account_name;

    // Create Paystack subaccount
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
        subaccountCode:
          subaccountResponse.data.data.subaccount_code,
        accountName: resolvedAccountName,
        bankName: bank.name,
        percentageCharge: 5
      }
    });

  } catch (error) {
    console.error(
      "Paystack subaccount error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      status: false,
      message:
        error.response?.data?.message ||
        "Could not create restaurant Paystack subaccount"
    });
  }
});
app.get("/api/paystack/verify/:reference", async (req, res) => {
  try {
    const { reference } = req.params;

    if (!reference) {
      return res.status(400).json({
        status: false,
        message: "Transaction reference is required"
      });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      "Paystack verification error:",
      error.response?.data || error.message
    );

    res.status(500).json({
      status: false,
      message: "Could not verify payment"
    });
  }
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Feli Food server running on port ${PORT}`);
});