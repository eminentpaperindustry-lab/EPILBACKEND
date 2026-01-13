const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const { getSheets } = require("../googleSheetsClient");


// ---------------- ADD ADDITIONAL FEATURE ----------------
router.post("/add", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    // Login user ka name (from auth middleware, assume req.user.name available)
    const addedBy = req.user.name;

    const { featureName, featureURL } = req.body;

    if (!featureName || !featureURL) {
      return res.status(400).json({ error: "Feature name and URL are required" });
    }

    // Append row to Google Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "AdditionalFeature!A:D",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [
          [addedBy, featureName, featureURL, new Date().toISOString()]
        ]
      }
    });

    res.json({ message: "Feature added successfully" });

  } catch (err) {
    console.error("ADD FEATURE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- GET ALL ADDITIONAL FEATURES ----------------
// ---------------- GET ADDITIONAL FEATURES FOR LOGGED-IN USER ----------------
router.get("/all", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "AdditionalFeatures!A:D",
    });

    const rows = result.data.values || [];

    // 🔹 Filter rows by logged-in user's name
    const userName = req.user.name;

    const features = rows
      .filter(r => r[0] === userName)  // A column = AddedBy
      .map(r => ({
        addedBy: r[0],
        featureName: r[1],
        featureURL: r[2],
        timestamp: r[3],
      }));

    res.json(features);

  } catch (err) {
    console.error("GET FEATURES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
