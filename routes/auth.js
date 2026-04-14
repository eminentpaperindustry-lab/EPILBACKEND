const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const { getSheets } = require("../googleSheetsClient");

// =====================================================
// REGISTER - UPDATED WITH PROFILE FIELDS
// =====================================================
router.post("/register", async (req, res) => {
  try {
    const { 
      name, 
      mobile, 
      password, 
      department,
      companyName,
      designation,
      joiningDate,
      dateOfBirth,
      doerName 
    } = req.body;

    if (!name || !mobile || !password || !department) {
      return res.status(400).json({ error: "All fields required" });
    }

    const sheets = await getSheets();

    // CHECK EXISTING
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

    // CREATE EMPLOYEE ENTRY WITH ALL 12 COLUMNS
    const EmployeeID = nanoid(6);
    const hashedPassword = await bcrypt.hash(password, 10);
    const createdDate = new Date().toISOString();

    // Format dates for Google Sheets (DD/MM/YYYY)
    const formatDate = (date) => {
      if (!date) return "";
      const d = new Date(date);
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    };

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:L",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          EmployeeID,                    // A: User ID
          name,                          // B: Employee Name
          mobile,                        // C: Mobile Number
          hashedPassword,                // D: Password
          department,                    // E: Department
          createdDate,                   // F: Created Date
          companyName || "",             // G: Company Name
          formatDate(dateOfBirth),       // H: Date of Birth
          formatDate(joiningDate),       // I: Joining Date
          "",                            // J: Profile Picture (empty initially)
          designation || "",             // K: Designation
          doerName || ""                 // L: Doer Name
        ]],
      },
    });

    res.json({ ok: true, EmployeeID });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// LOGIN - UPDATED WITH PROFILE FIELDS
// =====================================================
router.post("/login", async (req, res) => {
  try {
    const { employeeID, password } = req.body;

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
      {
        employeeID: user[0],
        name: user[1],
        department: user[4],
      },
      process.env.JWT_SECRET,
      { expiresIn: "2d" }
    );

    // Parse date from DD/MM/YYYY format
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split("/");
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return null;
    };

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
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;