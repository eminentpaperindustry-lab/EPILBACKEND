const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const SHEET_NAME = "DelegationMaster";

/* -------------------------- GET TASKS -------------------------- */
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:M`, // includes Taskcompletedapproval
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
        Taskcompletedapproval: r[12] || "", // NEW COLUMN
      }))
      .filter(
        (t) =>
          !(
            t.Status === "Completed" &&
            t.Taskcompletedapproval &&
            t.Taskcompletedapproval !== ""
          )
      ); // ❌ Hide completed+approved tasks from frontend

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- CREATE TASK -------------------------- */
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes } = req.body;

    const TaskID = nanoid(6);
    const CreatedDate = new Date().toISOString();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A:M`,
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
            "", // Taskcompletedapproval blank
          ],
        ],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- MARK DONE -------------------------- */
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const id = req.params.id;
    const sheets = await getSheets();

    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:M`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === id && r[1] === req.user.name);

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][7] = new Date().toISOString(); // FinalDate
    rows[idx][10] = "Completed"; // Status
    rows[idx][12] = "Approved"; // NEW: Taskcompletedapproval

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:M${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------- SHIFT -------------------------- */
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body;
    const id = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:M`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === id && r[1] === req.user.name);

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;

    rows[idx][8] = Number(rows[idx][8] || 0) + 1; // Revision count
    rows[idx][10] = "Shifted";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:M${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
