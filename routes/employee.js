const express = require("express");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

// GET ALL EMPLOYEE NAMES
router.get("/all", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:B",
    });

    const employees = (empRes.data.values || []).map(e => ({
      employeeID: e[0],
      name: e[1],
    }));

    res.json(employees);
  } catch (err) {
    console.error("EMPLOYEE ALL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
