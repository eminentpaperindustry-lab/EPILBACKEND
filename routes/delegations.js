const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();
const SHEET_NAME = "DelegationMaster";

// Helper function to safely access a cell in the sheet
const getCellValue = (row, index, defaultValue = "") => {
  return row[index] || defaultValue;
};

// Get tasks for logged-in user
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const tasks = rows
      .filter((r) => r[1] === req.user.name)
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
        Status: r[10] || "Pending",
        Followup: r[11] || "",
        Taskcompletedapproval: r[13] || "Pending",
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new task
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes, Name } = req.body;
    const TaskID = nanoid(6);
    const CreatedDate = new Date().toISOString();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            TaskID,
            Name ?? req.user.name,
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
            "",
            "Pending",
          ],
        ],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit Task (Update task details) - Only task details update, no other logic modified
router.put("/update/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { TaskName, Deadline, Priority, Notes, Status } = req.body;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    // const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    const idx = rows.findIndex((r) => r[0] === taskId );


    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Only update task details (TaskName, Deadline, Priority, Notes, Status)
    rows[idx][2] = TaskName || rows[idx][2]; // TaskName
    rows[idx][4] = Deadline || rows[idx][4]; // Deadline
    rows[idx][9] = Priority || rows[idx][9]; // Priority
    rows[idx][10] = Status || rows[idx][10]; // Status
    rows[idx][11] = Notes || rows[idx][11]; // Notes

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updatedTask: rows[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Task
router.delete("/delete/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    // const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    const idx = rows.findIndex((r) => r[0] === taskId );


    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Delete the task (by removing the row from the sheet)
    rows.splice(idx, 1);

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`, // We'll overwrite the existing data
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    res.json({ ok: true, message: "Task deleted successfully" });
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
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Updating specific row columns (Completed status and FinalDate)
    rows[idx][7] = new Date().toISOString(); // FinalDate
    rows[idx][10] = "Completed"; // Status

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
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
    const { newDeadline, revisionField } = req.body;
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Shift the task date for Revision1 or Revision2
    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;

    const revCount = (rows[idx][8] ? parseInt(rows[idx][8]) : 0) + 1;
    rows[idx][8] = revCount;

    rows[idx][10] = "Shifted"; // Update status

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search by name
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];

    const tasks = rows
      .filter((r) => r[1]?.toLowerCase() === name.toLowerCase())
      .map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: r[8],
        Priority: r[9],
        Status: r[10],
        Followup: r[11],
        Taskcompletedapproval: r[13] || "Pending",
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve / Unapprove task


router.patch("/approve/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { approvalStatus } = req.body;

    if (!approvalStatus)
      return res.status(400).json({ error: "approvalStatus is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    // Ensure enough columns are in the row for updates
    while (rows[idx].length < 14) rows[idx].push("");

    if (approvalStatus === "Approved") {
      rows[idx][13] = "Approved";
      rows[idx][10] = "Completed";
    } else {
      rows[idx][13] = "Pending";
      rows[idx][7] = ""; // Clear FinalDate on reversion
      rows[idx][10] = "Pending";
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updated: rows[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
