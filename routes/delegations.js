const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const SHEET_NAME = "DelegationMaster";

<<<<<<< HEAD
// =========================
//  GET TASKS for Logged User
// =========================
=======
// Get tasks for logged-in user
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
<<<<<<< HEAD
      range: `${SHEET_NAME}!A2:O`, // A to N (0–13)
    });

    const rows = fetch.data.values || [];

    const tasks = rows
      .filter((r) => r[1] === req.user.name)
=======
      range: `${SHEET_NAME}!A2:O`,
    });

    const rows = fetch.data.values || [];
    console.log("fetch.data.values:",fetch.data.values);
    
    const tasks = rows
      .filter((r) => r[1] === req.user.name) // Filter by employee name
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
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
<<<<<<< HEAD
        Status: r[10] || "Pending",
        Followup: r[11] || "",
        Taskcompletedapproval: r[13] || "Pending", // FIXED INDEX
=======
        Taskcompletedapproval:"NotApproved",
        Status: r[10] || "Pending",
        Followup: r[11] || "",
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

<<<<<<< HEAD

// =========================
//      CREATE NEW TASK
// =========================
=======
// Create new task
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes } = req.body;
    const TaskID = nanoid(6);
    const CreatedDate = new Date().toISOString();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
<<<<<<< HEAD
      range: `${SHEET_NAME}!A:N`,
=======
      range: `${SHEET_NAME}!A:L`,
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
<<<<<<< HEAD
            TaskID,         // 0
            req.user.name,  // 1
            TaskName,       // 2
            CreatedDate,    // 3
            Deadline,       // 4
            "",             // 5 Revision1
            "",             // 6 Revision2
            "",             // 7 Final Date
            0,              // 8 Revisions
            Priority,       // 9
            "Pending",      // 10 Status
            Notes,          // 11 Followup
            "",             // 12 (Ignored Column)
            "Pending"       // 13 Taskcompletedapproval (FIXED)
=======
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
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
          ],
        ],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

<<<<<<< HEAD

// =========================
//         TASK DONE
// =========================
=======
// Mark task done
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const sheets = await getSheets();

    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
<<<<<<< HEAD
      range: `${SHEET_NAME}!A2:O`,
=======
      range: `${SHEET_NAME}!A2:L`,
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

<<<<<<< HEAD
    rows[idx][7] = new Date().toISOString(); // Final Date index = 7
    rows[idx][10] = "Completed";             // Status index = 10

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:N${idx + 2}`,
=======
    rows[idx][7] = new Date().toISOString(); // FinalDate
    rows[idx][10] = "Completed"; // Status

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:L${idx + 2}`,
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

<<<<<<< HEAD

// =========================
//       SHIFT TASK
// =========================
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body;
=======
// Shift task (Revision1 / Revision2)
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body; // revisionField = Revision1 or Revision2
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
<<<<<<< HEAD
      range: `${SHEET_NAME}!A2:O`,
=======
      range: `${SHEET_NAME}!A2:L`,
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

<<<<<<< HEAD
    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;

    const revCount = (rows[idx][8] ? parseInt(rows[idx][8]) : 0) + 1;
    rows[idx][8] = revCount;

=======
    // Update revision field
    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;

    // Update Revisions count
    const revCount = (rows[idx][8] ? parseInt(rows[idx][8]) : 0) + 1;
    rows[idx][8] = revCount;

    // Update Status
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
    rows[idx][10] = "Shifted";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
<<<<<<< HEAD
      range: `${SHEET_NAME}!A${idx + 2}:N${idx + 2}`,
=======
      range: `${SHEET_NAME}!A${idx + 2}:L${idx + 2}`,
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

<<<<<<< HEAD

// =========================
//   SEARCH BY NAME
// =========================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;

    if (!name) return res.status(400).json({ error: "Name is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:O`,
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


// =========================
//   APPROVE / UNAPPROVE TASK
// =========================
router.patch("/approve/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { approvalStatus } = req.body;

    if (!approvalStatus)
      return res.status(400).json({ error: "approvalStatus is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:O`,
    });

    const rows = fetch.data.values || [];

    const idx = rows.findIndex(
      (r) => r[0] === taskId && r[1] === req.user.name
    );

    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    while (rows[idx].length < 14) rows[idx].push("");

    if (approvalStatus === "Approved") {
      rows[idx][13] = "Approved"; // FIXED INDEX
      rows[idx][10] = "Completed";
    } else {
      rows[idx][13] = "Pending";
      rows[idx][7] = "";
      rows[idx][10] = "Pending";
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${idx + 2}:N${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updated: rows[idx] });

=======
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
>>>>>>> 3541510af8ef30ff0960bb61fb13ce6f25b7cafe
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
