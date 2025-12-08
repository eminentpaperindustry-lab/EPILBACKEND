const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { getNextDeadline } = require("../utils/recurrence");

const router = express.Router();

//-----------------------------------------------------------------------
// AUTO GENERATE CHECKLIST IF MISSED OR RECURRING
//-----------------------------------------------------------------------
async function autoGenerateChecklists(sheetName, sheets) {
  const fetchRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!A2:G`,
  });

  const rows = fetchRes.data.values || [];
  const now = new Date();
  const today = now.toISOString().split("T")[0];

  let newRows = [];

  for (let r of rows) {
    const id = r[0];
    const name = r[1];
    const created = r[2];
    const deadline = r[3];
    const done = r[4];
    const status = r[5];
    const format = r[6];

    const deadlineDate = new Date(deadline);

    // 1️⃣ If not done and deadline passed → leave pending + create new one
    if (status !== "Done" && deadlineDate < now) {
      const newDeadline = getNextDeadline(format);

      const newID = nanoid(6);
      newRows.push([newID, name, today, newDeadline, "", "Pending", format]);
    }

    // 2️⃣ If done → create next recurring checklist
    if (status === "Done") {
      const newDeadline = getNextDeadline(format);
      const newID = nanoid(6);

      if (!rows.find(x => x[3] === newDeadline && x[1] === name)) {
        newRows.push([newID, name, today, newDeadline, "", "Pending", format]);
      }
    }
  }

  if (newRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: newRows },
    });
  }
}

//-----------------------------------------------------------------------
// GET ALL CHECKLISTS
//-----------------------------------------------------------------------
router.get("/", auth, async (req, res) => {
  try {
    const sheetName = `${req.user.name}_Checklist`;
    const sheets = await getSheets();

    await autoGenerateChecklists(sheetName, sheets);

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A2:G`,
    });

    const rows = fetchRes.data.values || [];
    const now = new Date();

    const checklists = rows.map((r) => {
      const item = {
        ChecklistID: r[0],
        ChecklistName: r[1],
        CreatedDate: r[2],
        Deadline: r[3],
        DoneDate: r[4],
        Status: r[5],
        Format: r[6],
      };

      if (item.Status !== "Done") {
        const deadline = new Date(item.Deadline);
        if (deadline < now) {
          item.Delay = Math.floor((now - deadline) / (1000 * 60 * 60 * 24));
        }
      }

      return item;
    });

    res.json(checklists);
  } catch (err) {
    console.error("Checklist GET Err:", err);
    res.status(500).json({ error: err.message });
  }
});

//-----------------------------------------------------------------------
// CREATE CHECKLIST (ONLY ONCE FOR FORMAT)
//-----------------------------------------------------------------------
router.post("/", auth, async (req, res) => {
  try {
    const { ChecklistName, Format } = req.body;

    const today = new Date().toISOString().split("T")[0];
    const initialDeadline = getNextDeadline(Format);

    const sheetName = `${req.user.name}_Checklist`;
    const sheets = await getSheets();

    const ChecklistID = nanoid(6);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [ChecklistID, ChecklistName, today, initialDeadline, "", "Pending", Format],
        ],
      },
    });

    res.json({ ok: true, ChecklistID });
  } catch (err) {
    console.error("Checklist Create Err:", err);
    res.status(500).json({ error: err.message });
  }
});

//-----------------------------------------------------------------------
// MARK AS DONE → AUTO GENERATE NEXT CHECKLIST
//-----------------------------------------------------------------------
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const checklistId = req.params.id;
    const sheetName = `${req.user.name}_Checklist`;
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A2:G`,
    });

    const rows = fetchRes.data.values || [];
    const idx = rows.findIndex((r) => r[0] === checklistId);
    if (idx === -1) return res.status(404).json({ error: "Checklist not found" });

    const row = rows[idx];
    const format = row[6];
    const name = row[1];

    const now = new Date().toISOString();

    row[4] = now;
    row[5] = "Done";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A${idx + 2}:G${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] },
    });

    // Create next recurring checklist
    const today = now.split("T")[0];
    const newDeadline = getNextDeadline(format);
    const newID = nanoid(6);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:G`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [newID, name, today, newDeadline, "", "Pending", format],
        ],
      },
    });

    res.json({ ok: true, DoneDate: now });
  } catch (err) {
    console.error("Checklist Done Err:", err);
    res.status(400).json({ error: err.message });
  }
});

//-----------------------------------------------------------------------
// DELETE CHECKLIST
//-----------------------------------------------------------------------
router.delete("/:id", auth, async (req, res) => {
  try {
    const checklistId = req.params.id;
    const sheetName = `${req.user.name}_Checklist`;
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A2:G`,
    });

    const rows = fetchRes.data.values || [];
    const idx = rows.findIndex((r) => r[0] === checklistId);
    if (idx === -1) return res.status(404).json({ error: "Checklist not found" });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A${idx + 2}:G${idx + 2}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Checklist Delete Err:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
