const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { formatDateIST, parseDDMMYYYY, getWeekRange } = require("../utils/dateHelpers");
const { getCache, setCache, invalidateCache } = require("../utils/sheetCache");

const router = express.Router();
const SHEET_NAME = "DelegationMaster";

// ======================================================
// SMART SHEET READ WITH CACHE
// ======================================================
async function readDelegationSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
  const range = `${SHEET_NAME}!A2:R`;

  const cached = getCache(spreadsheetId, range);
  if (cached) return cached;

  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const data = res.data.values || [];
  setCache(spreadsheetId, range, data);
  return data;
}

async function writeDelegationCell(rowNumber, rowData) {
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
  const range = `${SHEET_NAME}!A${rowNumber}:R${rowNumber}`;

  for (let retry = 3; retry >= 0; retry--) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowData] },
      });
      invalidateCache(spreadsheetId, `${SHEET_NAME}!A2:R`);
      return;
    } catch (err) {
      if (retry === 0) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function mapTask(r) {
  return {
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
  };
}

// ======================================================
// GET TASKS FOR LOGGED-IN USER
// ======================================================
router.get("/", auth, asyncHandler(async (req, res) => {
  const rows = await readDelegationSheet();
  const tasks = rows.filter((r) => r[1] === req.user.name).map(mapTask);
  res.json(tasks);
}));

// ======================================================
// CREATE NEW TASK
// ======================================================
router.post("/", auth, asyncHandler(async (req, res) => {
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
    TaskID, Name ?? req.user.name, TaskName, formatDateIST(), Deadline,
    "", "", "", 0, Priority || "", "Pending", AssignBy || "", "", "Pending",
    "", "", "", ""
  ];

  for (let retry = 3; retry >= 0; retry--) {
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${SHEET_NAME}!A${nextRow}:R${nextRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowData] },
      });
      invalidateCache(spreadsheetId, `${SHEET_NAME}!A2:R`);
      break;
    } catch (err) {
      if (retry === 0) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  res.json({ ok: true, TaskID });
}));

// ======================================================
// FILTER TASKS BY MONTH/WEEK
// ======================================================
router.get("/filter", auth, asyncHandler(async (req, res) => {
  const { month, week, selectedName } = req.query;
  if (!month || !week) {
    return res.status(400).json({ error: "Month and Week are required" });
  }

  const rows = await readDelegationSheet();
  const nameToFilter = (selectedName?.trim() || req.user.name.trim()).toLowerCase();
  const { weekStart, weekEnd } = getWeekRange(month, week);

  let filtered = rows.filter((r) => (r[1] || "").trim().toLowerCase() === nameToFilter);
  filtered = filtered.filter((task) => {
    const created = parseDDMMYYYY(task[3]);
    const completed = task[7] ? parseDDMMYYYY(task[7]) : null;
    if (!created) return false;
    return created <= weekEnd && (!completed || completed >= weekStart);
  });

  let total = filtered.length, completedCount = 0, pendingCount = 0, onTime = 0, delayed = 0;

  filtered.forEach((task) => {
    const completed = task[7] ? parseDDMMYYYY(task[7]) : null;
    const deadline = parseDDMMYYYY(task[4]);
    if (completed && completed >= weekStart && completed <= weekEnd) {
      completedCount++;
      deadline && completed <= deadline ? onTime++ : delayed++;
    } else {
      pendingCount++;
    }
  });

  res.json({
    totalWork: total,
    completedTaskCount: completedCount,
    pendingTaskCount: pendingCount,
    pendingTaskPercentage: total ? ((pendingCount / total) * 100).toFixed(2) : 0,
    onTimeCount: onTime,
    delayedWorkPercentage: completedCount ? ((delayed / completedCount) * 100).toFixed(2) : 0,
    weekStart: weekStart.toLocaleDateString('en-CA'),
    weekEnd: weekEnd.toLocaleDateString('en-CA'),
    tasks: filtered.map(mapTask),
  });
}));

// ======================================================
// UPDATE TASK
// ======================================================
router.put("/update/:id", auth, asyncHandler(async (req, res) => {
  const { TaskName, Deadline, Priority, Notes, Status } = req.body;
  const rows = await readDelegationSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  if (TaskName) rows[idx][2] = TaskName;
  if (Deadline) rows[idx][4] = Deadline;
  if (Priority) rows[idx][9] = Priority;
  if (Status) rows[idx][10] = Status;
  if (Notes !== undefined) rows[idx][11] = Notes;

  await writeDelegationCell(idx + 2, rows[idx]);
  res.json({ ok: true, updatedTask: rows[idx] });
}));

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/delete/:id", auth, asyncHandler(async (req, res) => {
  const rows = await readDelegationSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  rows.splice(idx, 1);
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_DELEGATION;
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${SHEET_NAME}!A2:R`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
  invalidateCache(spreadsheetId, `${SHEET_NAME}!A2:R`);

  res.json({ ok: true, message: "Task deleted successfully" });
}));

// ======================================================
// MARK TASK DONE
// ======================================================
router.patch("/done/:id", auth, asyncHandler(async (req, res) => {
  const rows = await readDelegationSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id && r[1] === req.user.name);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  const now = new Date();
  rows[idx][7] = formatDateIST(now);
  rows[idx][10] = "Completed";
  rows[idx][12] = formatDateIST(new Date(now.setDate(now.getDate() - now.getDay() + 1)));

  await writeDelegationCell(idx + 2, rows[idx]);
  res.json({ ok: true });
}));

// ======================================================
// SHIFT TASK DEADLINE
// ======================================================
router.patch("/shift/:id", auth, asyncHandler(async (req, res) => {
  const { newDeadline } = req.body;
  if (!newDeadline) return res.status(400).json({ error: "newDeadline is required" });

  const rows = await readDelegationSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id && r[1] === req.user.name);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  rows[idx][4] = newDeadline;
  rows[idx][8] = (parseInt(rows[idx][8]) || 0) + 1;
  rows[idx][10] = "Shifted";

  await writeDelegationCell(idx + 2, rows[idx]);
  res.json({ ok: true });
}));

// ======================================================
// SEARCH BY NAME
// ======================================================
router.get("/search/by-name", auth, asyncHandler(async (req, res) => {
  const { name, assignBy } = req.query;
  if (!name) return res.status(400).json({ error: "Name is required" });

  const rows = await readDelegationSheet();
  const nameLower = name.toLowerCase();
  let filtered = nameLower === "all" ? rows : rows.filter((r) => (r[1] || "").toLowerCase() === nameLower);

  if (assignBy && assignBy.toLowerCase() !== "all") {
    filtered = filtered.filter((r) => (r[11] || "").toLowerCase() === assignBy.toLowerCase());
  }

  res.json(filtered.map(mapTask));
}));

// ======================================================
// APPROVE / UNAPPROVE TASK
// ======================================================
router.patch("/approve/:id", auth, asyncHandler(async (req, res) => {
  const { approvalStatus } = req.body;
  if (!approvalStatus) return res.status(400).json({ error: "approvalStatus is required" });

  const rows = await readDelegationSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  while (rows[idx].length < 14) rows[idx].push("");

  if (approvalStatus === "Approved") {
    rows[idx][13] = "Approved";
    rows[idx][10] = "Completed";
  } else {
    rows[idx][13] = "Pending";
    rows[idx][7] = "";
    rows[idx][12] = "";
    rows[idx][10] = "Pending";
  }

  await writeDelegationCell(idx + 2, rows[idx]);
  res.json({ ok: true, updated: rows[idx] });
}));

module.exports = router;