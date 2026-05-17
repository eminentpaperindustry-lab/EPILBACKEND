const express = require("express");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { parser } = require("../cloudinary");
const { formatDateDMY, parseDateFromDMY } = require("../utils/dateHelpers");

const router = express.Router();

// ==================== GET ALL EMPLOYEES ====================
router.get("/all", auth, asyncHandler(async (req, res) => {
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
}));

// ==================== GET USER PROFILE ====================
router.get("/profile", auth, asyncHandler(async (req, res) => {
  const sheets = await getSheets();
  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Employee!A2:L",
  });

  const employees = empRes.data.values || [];
  const user = employees.find(e => e[0] === req.user.employeeID);

  if (!user) return res.status(404).json({ error: "User not found" });

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
}));

// ==================== UPDATE USER PROFILE ====================
router.put("/update-profile", auth, parser.single("profilePicture"), asyncHandler(async (req, res) => {
  const { companyName, designation, joiningDate, dateOfBirth, donorName } = req.body;
  const sheets = await getSheets();

  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "Employee!A2:L",
  });

  const employees = empRes.data.values || [];
  let rowIndex = -1, currentUser = null;

  for (let i = 0; i < employees.length; i++) {
    if (employees[i][0] === req.user.employeeID) { rowIndex = i; currentUser = employees[i]; break; }
  }

  if (!currentUser) return res.status(404).json({ error: "User not found" });

  const updatedRow = [...currentUser];
  if (companyName !== undefined) updatedRow[6] = companyName;
  if (designation !== undefined) updatedRow[10] = designation;
  if (joiningDate) updatedRow[8] = formatDateDMY(joiningDate);
  if (dateOfBirth) updatedRow[7] = formatDateDMY(dateOfBirth);
  if (donorName !== undefined) updatedRow[11] = donorName;

  let profilePictureUrl = "";
  if (req.file) {
    profilePictureUrl = req.file.path;
    updatedRow[9] = profilePictureUrl;
  } else if (currentUser[9]) {
    profilePictureUrl = currentUser[9];
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Employee!A${rowIndex + 2}:L${rowIndex + 2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [updatedRow] }
  });

  res.json({
    message: "Profile updated successfully",
    profilePicture: profilePictureUrl,
    companyName, designation, joiningDate, dateOfBirth, donorName
  });
}));

// ==================== GET ALL ADMIN ====================
router.get("/allAdmin", auth, asyncHandler(async (req, res) => {
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
}));

module.exports = router;