const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const SHEET_NAME = "DelegationMaster";

// Get tasks for logged-in user
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:O`,
    });

    const rows = fetch.data.values || [];
    console.log("fetch.data.values:",fetch.data.values);
    
    const tasks = rows
      .filter((r) => r[1] === req.user.name) // Filter by employee name
      .map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: parseInt(r[8]) || 0,
        Priority: r[9],
        Taskcompletedapproval:r[13],
        Status: r[10] || "Pending",
        Followup: r[11] || "",
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new task
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes } = req.body;
    const TaskID = nanoid(6);
    const CreatedDate = new Date().toISOString();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A:L`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            TaskID,
            req.user.name,
            TaskName,
            CreatedDate,
            Deadline,
            "",
            "",
            "",
            0,
            Priority,
            "Pending",
            Notes,
          ],
        ],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark task done
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const sheets = await getSheets();

    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:L`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][7] = new Date().toISOString(); // FinalDate
    rows[idx][10] = "Completed"; // Status

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:L${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shift task (Revision1 / Revision2)
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body; // revisionField = Revision1 or Revision2
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:L`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Update revision field
    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;

    // Update Revisions count
    const revCount = (rows[idx][8] ? parseInt(rows[idx][8]) : 0) + 1;
    rows[idx][8] = revCount;

    // Update Status
    rows[idx][10] = "Shifted";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:L${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete task (optional)
router.delete("/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:L`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:L${idx + 2}`,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
