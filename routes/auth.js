const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const { getSheets } = require("../googleSheetsClient");
const asyncHandler = require("../middleware/asyncHandler");
const { formatDateDMY } = require("../utils/dateHelpers");

// =====================================================
// REGISTER
// =====================================================
router.post("/register", asyncHandler(async (req, res) => {
  const { name, mobile, password, department, companyName, designation, joiningDate, dateOfBirth, doerName } = req.body;

  if (!name || !mobile || !password || !department) {
    return res.status(400).json({ error: "All fields required" });
  }

  if (mobile.length < 10) {
    return res.status(400).json({ error: "Valid mobile number required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const sheets = await getSheets();
  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Employee!A2:L",
  });

  const employees = empRes.data.values || [];

  if (employees.find((e) => e[1] === name)) {
    return res.status(400).json({ error: "UserName already registered" });
  }

  if (employees.find((e) => e[2] === mobile)) {
    return res.status(400).json({ error: "Mobile already registered" });
  }

  const EmployeeID = nanoid(6);
  const hashedPassword = await bcrypt.hash(password, 10);
  const createdDate = new Date().toISOString();

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Employee!A2:L",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        EmployeeID, name, mobile, hashedPassword, department, createdDate,
        companyName || "", formatDateDMY(dateOfBirth), formatDateDMY(joiningDate),
        "", designation || "", doerName || ""
      ]],
    },
  });

  res.json({ ok: true, EmployeeID });
}));

// =====================================================
// LOGIN
// =====================================================
router.post("/login", asyncHandler(async (req, res) => {
  const { employeeID, password } = req.body;

  if (!employeeID || !password) {
    return res.status(400).json({ error: "EmployeeID and password required" });
  }

  const sheets = await getSheets();
  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Employee!A2:L",
  });

  const employees = empRes.data.values || [];
  const user = employees.find((u) => u[0] === employeeID);

  if (!user) return res.status(404).json({ error: "User not found" });

  const passOK = await bcrypt.compare(password, user[3]);
  if (!passOK) return res.status(401).json({ error: "Incorrect password" });

  const token = jwt.sign(
    { employeeID: user[0], name: user[1], department: user[4] },
    process.env.JWT_SECRET,
    { expiresIn: "2d" }
  );

  res.json({
    ok: true,
    token,
    user: {
      employeeID: user[0],
      name: user[1],
      department: user[4],
      mobile: user[2],
      companyName: user[6] || "",
      dateOfBirth: parseDate(user[7]),
      joiningDate: parseDate(user[8]),
      profilePicture: user[9] || "",
      designation: user[10] || "",
      donorName: user[11] || "",
      sheet: `${user[1]}_Delegations`,
    },
  });
}));

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return null;
}

module.exports = router;