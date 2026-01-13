const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");


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
  range: "AdditionalFeature!A:D", // Corrected to match tab name
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
    const userName = req.user.name; // logged-in user ka name
    if (!userName) return res.status(400).json({ error: "User name not found" });

    const sheets = await getSheets();

    // 🔹 Correct sheet range (start from row 2, no need to slice)
    // const sheetRes = await sheets.spreadsheets.values.get({
    //   spreadsheetId: process.env.GOOGLE_SHEET_ID,
    //   range: "AdditionalFeatures!A2:D", // row 2 se start, skip header
    // });

console.log("sami testing");


     const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "AdditionalFeature!A2:D",
    });

    const rows = sheetRes.data.values || [];

    // 🔹 Map rows to objects
    const userFeatures = rows
      .filter(r => r[0] === userName) // filter by AddedBy
      .map(r => ({
        AddedBy: r[0] || "",
        FeatureName: r[1] || "",
        FeatureURL: r[2] || "",
        CreatedAt: r[3] || "",
      }));

    res.json(userFeatures);

  } catch (err) {
    console.error("GET ADDITIONAL FEATURES ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;
