const express = require("express");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { parser } = require("../cloudinary"); // ✅ Cloudinary parser use karo

const router = express.Router();

// Helper: Format date to DD/MM/YYYY
const formatDateToDMY = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

// Helper: Parse date from DD/MM/YYYY to YYYY-MM-DD
const parseDateFromDMY = (dateStr) => {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return null;
};

// ==================== GET ALL EMPLOYEES ====================
router.get("/all", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:L",
    });

    const employees = (empRes.data.values || []).map(e => ({
      employeeID: e[0],
      name: e[1],
      department: e[4],
      number: e[2],
      designation: e[10] || "",
      doerName: e[11] || ""
    }));

    res.json(employees);
  } catch (err) {
    console.error("EMPLOYEE ALL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET USER PROFILE ====================
router.get("/profile", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:L",
    });

    const employees = empRes.data.values || [];
    const user = employees.find(e => e[0] === req.user.employeeID);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      employeeID: user[0],
      name: user[1],
      mobile: user[2],
      department: user[4],
      createdDate: user[5] || "",
      companyName: user[6] || "",
      dateOfBirth: parseDateFromDMY(user[7]),
      joiningDate: parseDateFromDMY(user[8]),
      profilePicture: user[9] || null,
      designation: user[10] || "",
      donorName: user[11] || ""
    });
  } catch (err) {
    console.error("GET PROFILE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== UPDATE USER PROFILE (Cloudinary) ====================
router.put("/update-profile", auth, parser.single("profilePicture"), async (req, res) => {
  try {
    const { companyName, designation, joiningDate, dateOfBirth, donorName } = req.body;
    
    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:L",
    });

    const employees = empRes.data.values || [];
    let rowIndex = -1;
    let currentUser = null;

    for (let i = 0; i < employees.length; i++) {
      if (employees[i][0] === req.user.employeeID) {
        rowIndex = i;
        currentUser = employees[i];
        break;
      }
    }

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedRow = [...currentUser];

    // Update fields (column indices)
    if (companyName !== undefined) updatedRow[6] = companyName;      // G: Company Name
    if (designation !== undefined) updatedRow[10] = designation;     // K: Designation
    if (joiningDate) updatedRow[8] = formatDateToDMY(joiningDate);   // I: Joining Date
    if (dateOfBirth) updatedRow[7] = formatDateToDMY(dateOfBirth);   // H: Date of Birth
    if (donorName !== undefined) updatedRow[11] = donorName;         // L: Doer Name

    // ✅ Handle profile picture with Cloudinary
    let profilePictureUrl = "";
    if (req.file) {
      // Cloudinary se URL le lo (parser already upload kar chuka hai)
      profilePictureUrl = req.file.path; // Cloudinary URL
      updatedRow[9] = profilePictureUrl; // J: Profile Picture
    } else if (currentUser[9]) {
      profilePictureUrl = currentUser[9];
    }

    // Update in Google Sheets
    const rowNumber = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Employee!A${rowNumber}:L${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [updatedRow] }
    });

    res.json({
      message: "Profile updated successfully",
      profilePicture: profilePictureUrl,
      companyName,
      designation,
      joiningDate,
      dateOfBirth,
      donorName
    });
  } catch (err) {
    console.error("UPDATE PROFILE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== GET ALL ADMIN ====================
router.get("/allAdmin", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Admin!A2:H",
    });

    const employees = (empRes.data.values || []).map(e => ({
      employeeID: e[0],
      name: e[1],
      department: e[4],
      number: e[2]
    }));

    res.json(employees);
  } catch (err) {
    console.error("EMPLOYEE Admin ALL ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;