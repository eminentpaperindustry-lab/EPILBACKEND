const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const MASTER_SHEET = "ChecklistMaster"; // SINGLE DATA SOURCE

// ======================================================
// FREQUENCY DEADLINE GENERATOR (D/W/M)
// ======================================================
function getNextDeadline(freq) {
  const date = new Date();

  if (freq === "D") {
    date.setDate(date.getDate() + 1);
  } else if (freq === "W") {
    date.setDate(date.getDate() + 7);
  } else if (freq === "M") {
    date.setMonth(date.getMonth() + 1);
  }

  return date.toISOString().split("T")[0];
}

// ======================================================
// GET USER-SPECIFIC CHECKLIST ITEMS (FILTER BY NAME)
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    // Fetch all master checklist data
    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];

    const userName = req.user.name;

    // FILTER ROWS BY USER NAME
    const userRows = rows.filter((r) =>  r[0] === userName && (!r[7] || r[7].trim() === ""));

    const data = userRows.map((r) => ({
      Name: r[0],
      Email: r[1],
      Department: r[2],
      TaskID: r[3],
      Freq: r[4],
      Task: r[5],
      Planned: r[6], // deadline
      Actual: r[7], // done date
    }));

    res.json(data);
  } catch (err) {
    console.error("Checklist GET Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// Get Specific checklist search by Name

// ======================================================
// SEARCH CHECKLIST BY EMPLOYEE NAME (FULLY CORRECTED)
// ======================================================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }

    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A2:K`, // A to K → 11 columns (0–10)
    });

    const rows = fetchRes.data.values || [];

    // FILTER BY EXACT NAME (Case-insensitive)
    const filtered = rows
      .filter((r) => r[0]?.toLowerCase() === name.toLowerCase()) // Name (index 0)
      .map((r) => ({
        Name: r[0],
        Email: r[1],
        Department: r[2],
        TaskID: r[3],
        Freq: r[4],
        Task: r[5],
        Planned: r[6],
        Actual: r[7],
        EmailForBuddy: r[8],
        BuddyEmail: r[9],
        Archive: r[10]
      }));

    res.json(filtered);
  } catch (err) {
    console.error("Checklist Search Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// ======================================================
// CREATE A NEW TASK FOR USER (INSERT INTO MASTER SHEET)
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { Task, Freq } = req.body;

    if (!Task || !Freq) {
      return res.status(400).json({ error: "Task and Freq are required" });
    }

    const sheets = await getSheets();
    const TaskID = nanoid(6);
    const PlannedDate = getNextDeadline(Freq);

    const values = [
      [
        req.user.name,        // Name
        req.user.email || "", // Email
        req.user.department || "", // Department
        TaskID,
        Freq,
        Task,
        PlannedDate, // Planned
        "",          // Actual
        req.user.name, // Email for buddy (optional)
        `${new Date().toLocaleString("default", { month: "short" })}-${new Date().getFullYear().toString().slice(-2)}`, // Buddy Month
        "" // ARCHIVE
      ],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A:K`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ ok: true, TaskID, Planned: PlannedDate });
  } catch (err) {
    console.error("Checklist CREATE Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// MARK TASK AS DONE (UPDATE ACTUAL DATE)
// ======================================================
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];

    // Find row by Task ID
    const idx = rows.findIndex((r) => r[3] === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    const row = rows[idx];
    row[7] = new Date().toISOString(); // Actual = done

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    res.json({ ok: true, Actual: row[7] });
  } catch (err) {
    console.error("Checklist DONE Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/:id", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];
    const idx = rows.findIndex((r) => r[3] === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Checklist DELETE Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
