const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const { getSheets } = require("../googleSheetsClient");

// =====================================================
// REGISTER
// =====================================================
router.post("/register", async (req, res) => {
  try {
    const { name, mobile, password, department } = req.body;

    if (!name || !mobile || !password || !department) {
      return res.status(400).json({ error: "All fields required" });
    }

    const sheets = await getSheets();

    // -------------------------------------------------
    // CHECK EXISTING MOBILE
    // -------------------------------------------------
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:F",
    });

    const employees = empRes.data.values || [];

    if (employees.find((e) => e[2] === mobile)) {
      return res.status(400).json({ error: "Mobile already registered" });
    }

    // -------------------------------------------------
    // CREATE EMPLOYEE ENTRY
    // -------------------------------------------------
    const EmployeeID = nanoid(6);
    const hashedPassword = await bcrypt.hash(password, 10);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            EmployeeID,
            name,
            mobile,
            hashedPassword,
            department,
            new Date().toISOString(),
          ],
        ],
      },
    });

    // // =====================================================
    // // CREATE PERSONAL CHECKLIST SHEET
    // // =====================================================
    // const checklistSheetTitle = `${name}_Checklist`;

    // await sheets.spreadsheets.batchUpdate({
    //   spreadsheetId: process.env.GOOGLE_SHEET_ID,
    //   requestBody: {
    //     requests: [
    //       {
    //         addSheet: {
    //           properties: {
    //             title: checklistSheetTitle,
    //           },
    //         },
    //       },
    //     ],
    //   },
    // });

    // // Add column headers
    // await sheets.spreadsheets.values.update({
    //   spreadsheetId: process.env.GOOGLE_SHEET_ID,
    //   range: `${checklistSheetTitle}!A1:G1`,
    //   valueInputOption: "USER_ENTERED",
    //   requestBody: {
    //     values: [
    //       [
    //         "ChecklistID",
    //         "ChecklistName",
    //         "CreatedDate",
    //         "Deadline",
    //         "DoneDate",
    //         "Status",
    //         "Format",
    //       ],
    //     ],
    //   },
    // });

// =====================================================
// CREATE PERSONAL HELPTICKET SHEET
// =====================================================
const helpTicketSheetTitle = `${name}_HelpTickets`;

// Add new sheet
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: process.env.GOOGLE_SHEET_ID,
  requestBody: {
    requests: [
      {
        addSheet: {
          properties: {
            title: helpTicketSheetTitle,
          },
        },
      },
    ],
  },
});

// Add column headers
await sheets.spreadsheets.values.update({
  spreadsheetId: process.env.GOOGLE_SHEET_ID,
  range: `${helpTicketSheetTitle}!A1:G1`,
  valueInputOption: "USER_ENTERED",
  requestBody: {
    values: [
      [
        "TicketID",
        "Issue",
        "CreatedName",
        "AssignedTo",
        "CreatedDate",
        "DoneDate",
        "Status",
      ],
    ],
  },
});


    // =====================================================
    // CREATE PERSONAL DELEGATION SHEET
    // =====================================================
    const delegationSheetTitle = `${name}_Delegations`;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: delegationSheetTitle,
              },
            },
          },
        ],
      },
    });

    // Add column headers
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${delegationSheetTitle}!A1:H1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            "TaskID",
            "TaskName",
            "CreatedDate",
            "Deadline",
            "DoneDate",
            "Status",
            "Priority",
            "Notes",
          ],
        ],
      },
    });

    // -------------------------------
    // RESPONSE
    // -------------------------------
    res.json({ ok: true, EmployeeID });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// LOGIN
// =====================================================
router.post("/login", async (req, res) => {
  console.log("process.env: ",process.env);
  
  try {
    const { employeeID, password } = req.body;

    const sheets = await getSheets();
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A:F",
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

    res.json({
      ok: true,
      token,
      user: {
        employeeID: user[0],
        name: user[1],
        sheet: `${user[1]}_Delegations`,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
