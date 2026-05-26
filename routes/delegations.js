const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();
const SHEET_NAME = "DelegationMaster";

// ======================================================
// DATE FORMATTER
// ======================================================
function formatDateIST(date = new Date()) {
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

// ======================================================
// READ SHEET DATA
// ======================================================
async function readDelegationSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
  const range = `${SHEET_NAME}!A2:R`;
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function writeDelegationCell(rowNumber, rowData) {
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
  const range = `${SHEET_NAME}!A${rowNumber}:R${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [rowData] },
  });
}

function mapTask(r) {
  return {
    TaskID: r[0] || "",
    Name: r[1] || "",
    TaskName: r[2] || "",
    CreatedDate: r[3] || "",
    Deadline: r[4] || "",
    Revision1: r[5] || "",
    Revision2: r[6] || "",
    FinalDate: r[7] || "",
    Revisions: parseInt(r[8]) || 0,
    Priority: r[9] || "",
    Status: r[10] || "Pending",
    Followup: r[11] || "",
    AssignBy: r[12] || "",
    Taskcompletedapproval: r[13] || "Pending",
  };
}

// ======================================================
// GET TASKS
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const rows = await readDelegationSheet();
    const tasks = rows.filter((r) => r[1] === req.user.name).map(mapTask);
    res.json(tasks);
  } catch (err) {
    console.error("GET Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// CREATE BULK TASKS (Multiple Employees)
// ======================================================
router.post("/bulk", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, EmployeeNames, AssignBy } = req.body;

    if (!TaskName || !Deadline || !EmployeeNames || EmployeeNames.length === 0) {
      return res.status(400).json({ error: "TaskName, Deadline, and EmployeeNames are required" });
    }

    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
    
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${SHEET_NAME}!A:A`,
    });
    let nextRow = (readRes.data.values?.length || 1) + 1;

    const createdTasks = [];
    const failedTasks = [];

    for (const empName of EmployeeNames) {
      const TaskID = nanoid(6);
      const rowData = [
        TaskID, empName, TaskName, formatDateIST(), Deadline,
        "", "", "", "0", Priority || "", "Pending", AssignBy || "", AssignBy || "", "Pending",
        "", "", "", ""
      ];

      try {
        await sheets.spreadsheets.values.update({
          spreadsheetId, range: `${SHEET_NAME}!A${nextRow}:R${nextRow}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [rowData] },
        });
        createdTasks.push({ TaskID, EmployeeName: empName });
        nextRow++;
      } catch (err) {
        failedTasks.push({ EmployeeName: empName, error: err.message });
      }
    }

    res.json({ 
      ok: true, 
      createdCount: createdTasks.length, 
      failedCount: failedTasks.length,
      createdTasks,
      failedTasks
    });
  } catch (err) {
    console.error("Bulk create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// CREATE SINGLE TASK
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Name, AssignBy } = req.body;

    if (!TaskName || !Deadline) {
      return res.status(400).json({ error: "TaskName and Deadline are required" });
    }

    const TaskID = nanoid(6);
    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId, range: `${SHEET_NAME}!A:A`,
    });
    const nextRow = (readRes.data.values?.length || 1) + 1;

    const rowData = [
      TaskID, Name || req.user.name, TaskName, formatDateIST(), Deadline,
      "", "", "", "0", Priority || "", "Pending", AssignBy || "", AssignBy || "", "Pending",
      "", "", "", ""
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${SHEET_NAME}!A${nextRow}:R${nextRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rowData] },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    console.error("Create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SEARCH BY NAME (Supports multiple names)
// ======================================================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name, assignBy } = req.query;
    
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    const rows = await readDelegationSheet();
    
    if (!rows || rows.length === 0) {
      return res.json([]);
    }
    
    let filtered = [];
    
    // Handle multiple names (comma separated)
    if (name.includes(",")) {
      const names = name.split(",").map(n => n.trim().toLowerCase());
      filtered = rows.filter((r) => {
        const rowName = (r[1] || "").toLowerCase();
        return names.includes(rowName);
      });
    } 
    // Handle "all"
    else if (name.toLowerCase() === "all") {
      filtered = rows;
    } 
    // Handle single name
    else {
      filtered = rows.filter((r) => (r[1] || "").toLowerCase() === name.toLowerCase());
    }

    // Filter by AssignBy (column index 12)
    if (assignBy && assignBy.toLowerCase() !== "all" && assignBy !== "") {
      filtered = filtered.filter((r) => (r[12] || "").toLowerCase() === assignBy.toLowerCase());
    }

    res.json(filtered.map(mapTask));
    
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// UPDATE TASK
// ======================================================
router.put("/update/:id", auth, async (req, res) => {
  try {
    const { TaskName } = req.body;
    const rows = await readDelegationSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id);
    
    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (TaskName) {
      rows[idx][2] = TaskName;
    }

    await writeDelegationCell(idx + 2, rows[idx]);
    res.json({ ok: true, updatedTask: rows[idx] });
    
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/delete/:id", auth, async (req, res) => {
  try {
    const rows = await readDelegationSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id);
    
    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    rows.splice(idx, 1);
    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
    
    await sheets.spreadsheets.values.update({
      spreadsheetId, 
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    res.json({ ok: true, message: "Task deleted successfully" });
    
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// MARK TASK DONE
// ======================================================
router.patch("/done/:id", auth, async (req, res) => {
  try {
    const rows = await readDelegationSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id && r[1] === req.user.name);
    
    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    const now = new Date();
    rows[idx][7] = formatDateIST(now);
    rows[idx][10] = "Completed";

    await writeDelegationCell(idx + 2, rows[idx]);
    res.json({ ok: true });
    
  } catch (err) {
    console.error("Done error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SHIFT TASK DEADLINE
// ======================================================
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline } = req.body;
    
    if (!newDeadline) {
      return res.status(400).json({ error: "newDeadline is required" });
    }

    const rows = await readDelegationSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id && r[1] === req.user.name);
    
    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    rows[idx][4] = newDeadline;
    rows[idx][8] = String((parseInt(rows[idx][8]) || 0) + 1);
    rows[idx][10] = "Shifted";

    await writeDelegationCell(idx + 2, rows[idx]);
    res.json({ ok: true });
    
  } catch (err) {
    console.error("Shift error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// APPROVE / UNAPPROVE TASK
// ======================================================
router.patch("/approve/:id", auth, async (req, res) => {
  try {
    const { approvalStatus } = req.body;
    
    if (!approvalStatus) {
      return res.status(400).json({ error: "approvalStatus is required" });
    }

    const rows = await readDelegationSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id);
    
    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (approvalStatus === "Approved") {
      rows[idx][13] = "Approved";
      rows[idx][10] = "Completed";
    } else {
      rows[idx][13] = "Pending";
      rows[idx][7] = "";
      rows[idx][10] = "Pending";
    }

    await writeDelegationCell(idx + 2, rows[idx]);
    res.json({ ok: true, updated: rows[idx] });
    
  } catch (err) {
    console.error("Approval error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;