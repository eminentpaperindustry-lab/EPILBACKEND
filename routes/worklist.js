const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { formatDateIST } = require("../utils/dateHelpers");
const { getCache, setCache, invalidateCache } = require("../utils/sheetCache");

const router = express.Router();
const SHEET_NAME = "WorkList";

// ======================================================
// VALID FREQUENCIES
// ======================================================
const VALID_FREQUENCIES = ["Daily", "Weekly", "Monthly"];

// ======================================================
// SMART SHEET READ WITH CACHE
// ======================================================
async function readWorklistSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID_WORKLIST is not configured in .env");
  }
  const range = `${SHEET_NAME}!A2:E`;

  const cached = getCache(spreadsheetId, range);
  if (cached) return cached;

  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const data = res.data.values || [];
    setCache(spreadsheetId, range, data);
    return data;
  } catch (err) {
    if (err.message?.includes("permission") || err.code === 403) {
      throw new Error(`Service Account does not have access to WorkList sheet (ID: ${spreadsheetId}). Please share the sheet with: ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`);
    }
    throw err;
  }
}

function invalidateWorklistCache() {
  invalidateCache(process.env.GOOGLE_SHEET_ID_WORKLIST, `${SHEET_NAME}!A2:E`);
}

function mapWorklist(r) {
  return {
    WorkListId: r[0] || "",
    EmployeeName: r[1] || "",
    WorklistName: r[2] || "",
    Frequency: r[3] || "",
    WorkingTime: r[4] || "",
  };
}

// ======================================================
// VALIDATION HELPER
// ======================================================
function validateWorklist({ WorklistName, Frequency, WorkingTime }) {
  const errors = [];
  if (!WorklistName || !WorklistName.trim()) errors.push("WorklistName is required");
  if (!Frequency || !VALID_FREQUENCIES.includes(Frequency)) errors.push(`Frequency must be one of: ${VALID_FREQUENCIES.join(", ")}`);
  if (!WorkingTime || !WorkingTime.trim()) errors.push("WorkingTime is required");
  return errors;
}

// ======================================================
// DOER: GET MY WORKLISTS (Logged-in user only)
// ======================================================
router.get("/my", auth, asyncHandler(async (req, res) => {
  const rows = await readWorklistSheet();
  const myName = req.user.name;
  const myWorklists = rows
    .filter((r) => r[1] === myName)
    .map(mapWorklist);
  res.json({ ok: true, data: myWorklists, total: myWorklists.length });
}));

// ======================================================
// ADMIN: GET ALL WORKLISTS
// ======================================================
router.get("/all", auth, asyncHandler(async (req, res) => {
  const { employeeName, search } = req.query;
  const rows = await readWorklistSheet();

  let filtered = rows.map(mapWorklist);

  if (employeeName && employeeName !== "all") {
    filtered = filtered.filter((w) => w.EmployeeName === employeeName);
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(
      (w) =>
        w.WorklistName.toLowerCase().includes(q) ||
        w.EmployeeName.toLowerCase().includes(q) ||
        w.WorkListId.toLowerCase().includes(q)
    );
  }

  res.json({ ok: true, data: filtered, total: filtered.length });
}));

// ======================================================
// CREATE WORKLIST
// ======================================================
router.post("/", auth, asyncHandler(async (req, res) => {
  const { WorklistName, Frequency, WorkingTime, EmployeeName } = req.body;

  // Doer: auto-set name, Admin: use provided name
  const finalEmpName = EmployeeName || req.user.name;

  const errors = validateWorklist({ WorklistName, Frequency, WorkingTime });
  if (errors.length) return res.status(400).json({ error: errors.join(", ") });

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  const WorkListId = nanoid(8);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET_NAME}!A:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[WorkListId, finalEmpName, WorklistName.trim(), Frequency, WorkingTime.trim()]],
    },
  });

  invalidateWorklistCache();
  res.json({ ok: true, WorkListId, message: "Worklist created successfully" });
}));

// ======================================================
// UPDATE WORKLIST
// ======================================================
router.put("/:id", auth, asyncHandler(async (req, res) => {
  const { WorklistName, Frequency, WorkingTime } = req.body;
  const rows = await readWorklistSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

  // Doer can only update own worklist
  if (rows[idx][1] !== req.user.name) {
    return res.status(403).json({ error: "You can only update your own worklist" });
  }

  if (WorklistName) rows[idx][2] = WorklistName.trim();
  if (Frequency && VALID_FREQUENCIES.includes(Frequency)) rows[idx][3] = Frequency;
  if (WorkingTime) rows[idx][4] = WorkingTime.trim();

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${idx + 2}:E${idx + 2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [rows[idx]] },
  });

  invalidateWorklistCache();
  res.json({ ok: true, message: "Worklist updated", worklist: mapWorklist(rows[idx]) });
}));

// ======================================================
// ADMIN: UPDATE ANY WORKLIST (by employee)
// ======================================================
router.put("/admin/:id", auth, asyncHandler(async (req, res) => {
  const { WorklistName, Frequency, WorkingTime, EmployeeName } = req.body;
  const rows = await readWorklistSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

  if (WorklistName) rows[idx][2] = WorklistName.trim();
  if (Frequency && VALID_FREQUENCIES.includes(Frequency)) rows[idx][3] = Frequency;
  if (WorkingTime) rows[idx][4] = WorkingTime.trim();
  if (EmployeeName) rows[idx][1] = EmployeeName.trim();

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${idx + 2}:E${idx + 2}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [rows[idx]] },
  });

  invalidateWorklistCache();
  res.json({ ok: true, message: "Worklist updated by admin", worklist: mapWorklist(rows[idx]) });
}));

// ======================================================
// DELETE WORKLIST
// ======================================================
router.delete("/:id", auth, asyncHandler(async (req, res) => {
  const rows = await readWorklistSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

  // Doer can only delete own worklist
  if (rows[idx][1] !== req.user.name) {
    return res.status(403).json({ error: "You can only delete your own worklist" });
  }

  rows.splice(idx, 1);
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  invalidateWorklistCache();
  res.json({ ok: true, message: "Worklist deleted" });
}));

// ======================================================
// ADMIN: DELETE ANY WORKLIST
// ======================================================
router.delete("/admin/:id", auth, asyncHandler(async (req, res) => {
  const rows = await readWorklistSheet();
  const idx = rows.findIndex((r) => r[0] === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

  rows.splice(idx, 1);
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:E`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  invalidateWorklistCache();
  res.json({ ok: true, message: "Worklist deleted by admin" });
}));

// ======================================================
// BULK UPLOAD WORKLISTS
// ======================================================
router.post("/bulk", auth, asyncHandler(async (req, res) => {
  const { worklists } = req.body; // Array of { WorklistName, Frequency, WorkingTime, EmployeeName? }
  if (!Array.isArray(worklists) || worklists.length === 0) {
    return res.status(400).json({ error: "worklists array is required" });
  }

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  const existingRows = await readWorklistSheet();

  const created = [];
  const skipped = [];
  const errors = [];

  for (let i = 0; i < worklists.length; i++) {
    const wl = worklists[i];
    const empName = wl.EmployeeName || req.user.name;

    const validationErrors = validateWorklist({ WorklistName: wl.WorklistName, Frequency: wl.Frequency, WorkingTime: wl.WorkingTime });
    if (validationErrors.length) {
      errors.push({ row: i + 1, errors: validationErrors });
      continue;
    }

    // Check duplicate (same employee + same worklist name)
    const isDuplicate = existingRows.some(
      (r) => r[1] === empName && r[2]?.toLowerCase() === wl.WorklistName?.trim().toLowerCase()
    );
    if (isDuplicate) {
      skipped.push({ row: i + 1, WorklistName: wl.WorklistName, reason: "Duplicate" });
      continue;
    }

    const WorkListId = nanoid(8);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[WorkListId, empName, wl.WorklistName.trim(), wl.Frequency, wl.WorkingTime.trim()]],
      },
    });

    created.push({ row: i + 1, WorkListId, WorklistName: wl.WorklistName });
    existingRows.push([WorkListId, empName, wl.WorklistName.trim(), wl.Frequency, wl.WorkingTime.trim()]);
  }

  invalidateWorklistCache();
  res.json({
    ok: true,
    summary: { total: worklists.length, created: created.length, skipped: skipped.length, errors: errors.length },
    created,
    skipped,
    errors,
  });
}));

// ======================================================
// DOWNLOAD WORKLISTS (returns JSON for frontend to format)
// ======================================================
router.get("/download", auth, asyncHandler(async (req, res) => {
  const { employeeName } = req.query;
  const rows = await readWorklistSheet();

  let data = rows.map(mapWorklist);
  if (employeeName && employeeName !== "all") {
    data = data.filter((w) => w.EmployeeName === employeeName);
  }

  res.json({ ok: true, data, total: data.length });
}));

// ======================================================
// DOER: DOWNLOAD MY WORKLISTS
// ======================================================
router.get("/download/my", auth, asyncHandler(async (req, res) => {
  const rows = await readWorklistSheet();
  const data = rows
    .filter((r) => r[1] === req.user.name)
    .map(mapWorklist);
  res.json({ ok: true, data, total: data.length });
}));

module.exports = router;