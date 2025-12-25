const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();
const SHEET_NAME = "DelegationMaster";

// ======================================================
// DATE FORMATTER → dd/mm/yyyy hh:mm:ss (IST)
// ======================================================
function formatDateDDMMYYYYHHMMSS(date = new Date()) {
  // Convert to IST (UTC + 5:30)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utc + istOffset);

  const dd = String(istDate.getDate()).padStart(2, "0");
  const mm = String(istDate.getMonth() + 1).padStart(2, "0");
  const yyyy = istDate.getFullYear();
  const hh = String(istDate.getHours()).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  const ss = String(istDate.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

// Helper function to safely access a cell in the sheet
const getCellValue = (row, index, defaultValue = "") => {
  return row[index] || defaultValue;
};

// ======================================================
// GET TASKS FOR LOGGED-IN USER
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
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

// ======================================================
// CREATE NEW TASK
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes, Name } = req.body;
    const TaskID = nanoid(6);
    const CreatedDate = formatDateDDMMYYYYHHMMSS();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
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
        ]],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// UPDATE TASK DETAILS
// ======================================================
router.put("/update/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { TaskName, Deadline, Priority, Notes, Status } = req.body;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][2] = TaskName || rows[idx][2];
    rows[idx][4] = Deadline || rows[idx][4];
    rows[idx][9] = Priority || rows[idx][9];
    rows[idx][10] = Status || rows[idx][10];
    rows[idx][11] = Notes || rows[idx][11];

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updatedTask: rows[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/delete/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows.splice(idx, 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    res.json({ ok: true, message: "Task deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// MARK TASK DONE
// ======================================================
// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const taskId = req.params.id;
//     const sheets = await getSheets();
//     const fetch = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
//       range: `${SHEET_NAME}!A2:R`,
//     });

//     const rows = fetch.data.values || [];
//     const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
//     if (idx === -1) return res.status(404).json({ error: "Task not found" });

//     rows[idx][7] = formatDateDDMMYYYYHHMMSS(); // IST final date
//     rows[idx][10] = "Completed";

//     await sheets.spreadsheets.values.update({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
//       range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: [rows[idx]] },
//     });

//     res.json({ ok: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

router.patch("/done/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const sheets = await getSheets();

    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex(
      (r) => r[0] === taskId && r[1] === req.user.name
    );

    if (idx === -1)
      return res.status(404).json({ error: "Task not found" });

    // 🔹 Completion date (NOW)
    const completedDate = new Date();

    // 🔹 Week ka Monday nikalna
    const day = completedDate.getDay(); // 0=Sunday
    const diff = completedDate.getDate() - day + (day === 0 ? -6 : 1);
    const mondayDate = new Date(completedDate);
    mondayDate.setDate(diff);

    const pad = (n) => String(n).padStart(2, "0");

    const format = (d) =>
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    // ✅ index 7 → completed date
    rows[idx][7] = format(completedDate);

    // ✅ index 12 → us week ka Monday
    rows[idx][12] = format(mondayDate);

    rows[idx][10] = "Completed";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ======================================================
// SHIFT TASK (Revision1 / Revision2)
// ======================================================
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body;
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][revisionField === "Revision1" ? 5 : 6] = newDeadline;
    rows[idx][8] = (parseInt(rows[idx][8]) || 0) + 1;
    rows[idx][10] = "Shifted";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SEARCH BY NAME
// ======================================================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    if (name.toLowerCase() === "all") {
      return res.json(rows.map((r) => ({
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
      })));
    }

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

// ======================================================
// APPROVE / UNAPPROVE TASK
// ======================================================
router.patch("/approve/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { approvalStatus } = req.body;
    if (!approvalStatus) return res.status(400).json({ error: "approvalStatus is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    while (rows[idx].length < 14) rows[idx].push("");

    if (approvalStatus === "Approved") {
      rows[idx][13] = "Approved";
      rows[idx][10] = "Completed";
      rows[idx][7] = formatDateDDMMYYYYHHMMSS(); // IST final date
    } else {
      rows[idx][13] = "Pending";
      rows[idx][7] = "";
      rows[idx][12] = "";
      rows[idx][10] = "Pending";
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
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
