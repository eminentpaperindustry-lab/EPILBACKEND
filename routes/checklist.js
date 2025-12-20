const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const MASTER_SHEET = "ChecklistMaster";

// ======================================================
// DATE FORMATTER → dd/mm/yyyy hh:mm:ss
// ======================================================
function formatDateDDMMYYYYHHMMSS(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

// ======================================================
// FREQUENCY DEADLINE GENERATOR (D/W/M)
// ======================================================
function getNextDeadline(freq) {
  const date = new Date();

  if (freq === "D") date.setDate(date.getDate() + 1);
  else if (freq === "W") date.setDate(date.getDate() + 7);
  else if (freq === "M") date.setMonth(date.getMonth() + 1);

  return date.toISOString().split("T")[0];
}

// ======================================================
// GET USER CHECKLIST
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];
    const userName = req.user.name;

    const userRows = rows.filter(
      (r) => r[0] === userName && (!r[7] || r[7].trim() === "")
    );

    const data = userRows.map((r) => ({
      Name: r[0],
      Email: r[1],
      Department: r[2],
      TaskID: r[3],
      Freq: r[4],
      Task: r[5],
      Planned: r[6],
      Actual: r[7],
    }));

    res.json(data);
  } catch (err) {
    console.error("Checklist GET Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// CREATE TASK
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { Task, Freq } = req.body;
    if (!Task || !Freq) {
      return res.status(400).json({ error: "Task and Freq required" });
    }

    const sheets = await getSheets();
    const TaskID = nanoid(6);
    const PlannedDate = getNextDeadline(Freq);

    const values = [[
      req.user.name,
      req.user.email || "",
      req.user.department || "",
      TaskID,
      Freq,
      Task,
      PlannedDate,
      "",
      req.user.name,
      `${new Date().toLocaleString("default", { month: "short" })}-${new Date()
        .getFullYear()
        .toString()
        .slice(-2)}`,
      ""
    ]];

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
// MARK TASK AS DONE (FIXED DATE FORMAT)
// ======================================================
router.patch("/done/:id", auth, async (req, res) => {
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

    const row = rows[idx];

    // ✅ FIXED: SAVE REQUIRED FORMAT
    row[7] = formatDateDDMMYYYYHHMMSS(new Date());

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
