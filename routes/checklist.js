const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { formatDateIST, parseDDMMYYYY, getWeekRange } = require("../utils/dateHelpers");
const { getCache, setCache, invalidateCache } = require("../utils/sheetCache");

const router = express.Router();
const MASTER_SHEET = "Master";

// ======================================================
// SMART SHEET READ WITH CACHE
// ======================================================
async function readMasterSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;
  const range = `${MASTER_SHEET}!A2:K`;

  const cached = getCache(spreadsheetId, range);
  if (cached) return cached;

  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const data = res.data.values || [];
  setCache(spreadsheetId, range, data);
  return data;
}

function invalidateMasterCache() {
  invalidateCache(process.env.GOOGLE_SHEET_ID_CHECKLIST, `${MASTER_SHEET}!A2:K`);
}

function mapChecklist(r) {
  return {
    Name: r[0],
    Email: r[1],
    Department: r[2],
    TaskID: r[3],
    Freq: r[4],
    Task: r[5],
    Planned: r[6],
    Actual: r[7],
    EmailForBuddy: r[8] || "",
    BuddyEmail: r[9] || "",
    Archive: r[10] || "",
  };
}

// ======================================================
// GET USER-SPECIFIC CHECKLIST ITEMS
// ======================================================
router.get("/", auth, asyncHandler(async (req, res) => {
  const rows = await readMasterSheet();
  const userName = req.user.name;
  const userRows = rows.filter((r) => r[0] === userName && (!r[7] || r[7].trim() === ""));
  res.json(userRows.map(mapChecklist));
}));

// ======================================================
// SEARCH CHECKLIST BY EMPLOYEE NAME
// ======================================================
router.get("/search/by-name", auth, asyncHandler(async (req, res) => {
  const { name } = req.query;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });

  const rows = await readMasterSheet();
  const nameLower = name.toLowerCase();

  if (nameLower === "all") {
    return res.json(rows.map(mapChecklist));
  }

  const filtered = rows.filter((r) => (r[0] || "").toLowerCase() === nameLower).map(mapChecklist);
  res.json(filtered);
}));

// ======================================================
// CREATE A NEW TASK
// ======================================================
router.post("/", auth, asyncHandler(async (req, res) => {
  const { Task, Freq } = req.body;
  if (!Task || !Freq) return res.status(400).json({ error: "Task and Freq are required" });

  const sheets = await getSheets();
  const TaskID = nanoid(6);
  const PlannedDate = getNextDeadline(Freq);

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
    range: `${MASTER_SHEET}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        req.user.name, TaskID, Freq, Task, PlannedDate, "",
        req.user.name,
        `${new Date().toLocaleString("default", { month: "short" })}-${new Date().getFullYear().toString().slice(-2)}`,
        ""
      ]],
    },
  });

  invalidateMasterCache();
  res.json({ ok: true, TaskID, Planned: PlannedDate });
}));

// ======================================================
// MARK TASK AS DONE
// ======================================================
router.patch("/done/:id", auth, asyncHandler(async (req, res) => {
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;
  const currentDate = formatDateIST();

  const consolidatedRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `Consolidated!A2:B`,
  });

  const consolidatedRows = consolidatedRes.data.values || [];
  const rowIndex = consolidatedRows.findIndex(row => row[0] === req.params.id);

  const writeWithRetry = async (values, range, retry = 3) => {
    try {
      if (rowIndex === -1) {
        await sheets.spreadsheets.values.append({
          spreadsheetId, range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [values] },
        });
      } else {
        await sheets.spreadsheets.values.update({
          spreadsheetId, range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [values] },
        });
      }
    } catch (err) {
      if (retry === 0) throw err;
      await new Promise(r => setTimeout(r, 1000));
      return writeWithRetry(values, range, retry - 1);
    }
  };

  const range = rowIndex === -1 ? `Consolidated!A:B` : `Consolidated!A${rowIndex + 2}:B${rowIndex + 2}`;
  await writeWithRetry([req.params.id, currentDate], range);

  res.json({ ok: true, TaskID: req.params.id, DoneAt: currentDate });
}));

// ======================================================
// FILTER CHECKLIST BY MONTH/WEEK
// ======================================================
router.get("/filter", auth, asyncHandler(async (req, res) => {
  const { month, week, selectedName } = req.query;
  if (!month || !week) return res.status(400).json({ error: "Month and Week are required" });

  const rows = await readMasterSheet();
  const nameToFilter = (selectedName?.trim() || req.user.name.trim()).toLowerCase();
  const { weekStart, weekEnd } = getWeekRange(month, week);

  let filtered = rows.filter((r) => r[0] && r[0].trim().toLowerCase() === nameToFilter);
  filtered = filtered.filter((task) => {
    const planned = parseDDMMYYYY(task[6]);
    const actual = parseDDMMYYYY(task[7]);
    return (planned && planned >= weekStart && planned <= weekEnd) ||
           (actual && actual >= weekStart && actual <= weekEnd);
  });

  let total = filtered.length, completed = 0, pending = 0, onTime = 0, delayed = 0;

  filtered.forEach((task) => {
    const planned = parseDDMMYYYY(task[6]);
    const actual = parseDDMMYYYY(task[7]);
    if (actual && actual >= weekStart && actual <= weekEnd) {
      completed++;
      planned && actual <= planned ? onTime++ : delayed++;
    } else {
      pending++;
    }
  });

  res.json({
    totalTasks: total, completedTasks: completed, pendingTasks: pending,
    onTimeTasks: onTime, delayedTasks: delayed,
    pendingPercentage: total ? ((pending / total) * 100).toFixed(2) : "0.00",
    delayedPercentage: total ? ((delayed / total) * 100).toFixed(2) : "0.00",
    onTimePercentage: total ? ((onTime / total) * 100).toFixed(2) : "0.00",
    weekStart: weekStart.toLocaleDateString('en-CA'),
    weekEnd: weekEnd.toLocaleDateString('en-CA'),
    tasks: filtered.map((task) => ({
      Name: task[0], Email: task[1], Department: task[2],
      TaskID: task[3], Freq: task[4], Task: task[5],
      Planned: task[6], Actual: task[7],
      Status: task[7] ? "Completed" : "Pending"
    })),
  });
}));

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/:id", auth, asyncHandler(async (req, res) => {
  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;

  const fetchRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${MASTER_SHEET}!A2:K`,
  });
  const rows = fetchRes.data.values || [];
  const idx = rows.findIndex((r) => r[3] === req.params.id);

  if (idx === -1) return res.status(404).json({ error: "Task not found" });

  await sheets.spreadsheets.values.clear({
    spreadsheetId, range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
  });

  invalidateMasterCache();
  res.json({ ok: true });
}));

// ======================================================
// CREATE MASTER TEMPLATE + CURRENT MONTH TASKS
// ======================================================
router.post("/create-template", auth, asyncHandler(async (req, res) => {
  const { task, freq, dayOrDate, employeeName } = req.body;
  if (!task || !freq || !employeeName) {
    return res.status(400).json({ error: "Task, Freq and employeeName are required" });
  }

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;

  const empRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID, range: "Employee!A2:H",
  });
  const employees = empRes.data.values || [];
  const employee = employees.find(e => e[1] === employeeName);

  const templateId = nanoid(8);
  const templateRow = [
    templateId, employeeName, employee?.[1] || "", employee?.[6] || "",
    task, freq, dayOrDate || "", new Date().toISOString(), "active"
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `MasterTasks!A:I`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [templateRow] }
    });
  } catch (err) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `MasterTasks!A1:I1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["TemplateID", "Name", "Email", "Department", "Task", "Freq", "DayOrDate", "CreatedAt", "Status"]] }
    });
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `MasterTasks!A:I`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [templateRow] }
    });
  }

  // Generate remaining dates for current month
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();
  const currentDate = today.getDate();
  const monthEnd = new Date(currentYear, currentMonth, 0);

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `TestMaster!A2:K`,
  });
  const existingRows = existingRes.data.values || [];

  const createdTasks = [];
  let datesToCreate = [];

  if (freq === 'D') {
    for (let d = currentDate; d <= monthEnd.getDate(); d++) {
      datesToCreate.push(`${String(d).padStart(2, '0')}/${String(currentMonth).padStart(2, '0')}/${currentYear} 23:59:59`);
    }
  } else if (freq === 'W' && dayOrDate) {
    const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const targetDay = daysMap[dayOrDate.toLowerCase()];
    for (let d = currentDate; d <= monthEnd.getDate(); d++) {
      if (new Date(currentYear, currentMonth - 1, d).getDay() === targetDay) {
        datesToCreate.push(`${String(d).padStart(2, '0')}/${String(currentMonth).padStart(2, '0')}/${currentYear} 23:59:59`);
      }
    }
  } else if (freq === 'M' && dayOrDate) {
    const targetDate = parseInt(dayOrDate);
    if (targetDate >= currentDate && targetDate <= monthEnd.getDate()) {
      datesToCreate.push(`${String(targetDate).padStart(2, '0')}/${String(currentMonth).padStart(2, '0')}/${currentYear} 23:59:59`);
    }
  } else if (freq === 'Y' && dayOrDate) {
    const targetDate = parseInt(dayOrDate);
    if (targetDate >= currentDate && targetDate <= monthEnd.getDate()) {
      datesToCreate.push(`${String(targetDate).padStart(2, '0')}/${String(currentMonth).padStart(2, '0')}/${currentYear} 23:59:59`);
    }
  }

  for (const plannedDateTime of datesToCreate) {
    const alreadyExists = existingRows.some(row =>
      row[0] === employeeName && row[5] === task && row[6] === plannedDateTime
    );
    if (!alreadyExists) {
      const newTaskId = nanoid(6);
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: `TestMaster!A:K`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[employeeName, employee?.[1] || "", employee?.[2] || "", newTaskId, freq, task, plannedDateTime, "", "AUTO", templateId, ""]] }
      });
      createdTasks.push({ taskId: newTaskId, task, planned: plannedDateTime });
    }
  }

  res.json({
    success: true,
    message: `Template created + ${createdTasks.length} tasks for current month`,
    templateId, employeeName, task, freq, dayOrDate: dayOrDate || "N/A",
    currentMonthTasks: createdTasks,
    note: createdTasks.length === 0 ? "No remaining tasks for this month." : `Created ${createdTasks.length} tasks`
  });
}));

// ======================================================
// AUTO-GENERATE NEXT MONTH (CRON ONLY)
// ======================================================
router.post("/auto-generate-next-month", asyncHandler(async (req, res) => {
  if (req.headers['x-cron-job'] !== 'true') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sheets = await getSheets();
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;

  const today = new Date();
  let targetMonth = today.getMonth() + 2;
  let targetYear = today.getFullYear();
  if (targetMonth > 12) { targetMonth = 1; targetYear++; }

  const templatesRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `MasterTasks!A2:I`,
  });
  const templates = (templatesRes.data.values || []).filter(t => t[8] === "active");
  if (!templates.length) return res.json({ success: true, message: "No active templates", createdTasks: [] });

  const monthEnd = new Date(targetYear, targetMonth, 0);

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${MASTER_SHEET}!A2:K`,
  });
  const existingRows = existingRes.data.values || [];

  const createdTasks = [];
  const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

  for (const template of templates) {
    const [templateId, name, email, dept, task, freq, dayOrDate] = template;
    let datesToCreate = [];

    switch (freq) {
      case 'D':
        for (let d = 1; d <= monthEnd.getDate(); d++)
          datesToCreate.push(`${String(d).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear} 23:59:59`);
        break;
      case 'W':
        if (dayOrDate) {
          const targetDay = daysMap[dayOrDate.toLowerCase()];
          for (let d = 1; d <= monthEnd.getDate(); d++)
            if (new Date(targetYear, targetMonth - 1, d).getDay() === targetDay)
              datesToCreate.push(`${String(d).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear} 23:59:59`);
        }
        break;
      case 'M':
        if (dayOrDate) {
          const targetDate = Math.min(parseInt(dayOrDate), monthEnd.getDate());
          datesToCreate.push(`${String(targetDate).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear} 23:59:59`);
        }
        break;
      case 'Y':
        if (dayOrDate && parseInt(dayOrDate) <= monthEnd.getDate())
          datesToCreate.push(`${String(dayOrDate).padStart(2, '0')}/${String(targetMonth).padStart(2, '0')}/${targetYear} 23:59:59`);
        break;
    }

    for (const plannedDateTime of datesToCreate) {
      const alreadyExists = existingRows.some(row => row[0] === name && row[5] === task && row[6] === plannedDateTime);
      if (!alreadyExists) {
        const newTaskId = nanoid(6);
        await sheets.spreadsheets.values.append({
          spreadsheetId, range: `${MASTER_SHEET}!A:K`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[name, email || "", dept || "", newTaskId, freq, task, plannedDateTime, "", "AUTO", templateId, ""]] }
        });
        createdTasks.push({ taskId: newTaskId, task, planned: plannedDateTime, freq });
      }
    }
  }

  invalidateMasterCache();
  res.json({ success: true, message: `Generated ${createdTasks.length} tasks for ${targetMonth}/${targetYear}`, createdTasks });
}));

// ======================================================
// TEST ROUTE
// ======================================================
router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "Route works!" });
});

// Helper: Get next deadline based on frequency
function getNextDeadline(freq) {
  const date = new Date();
  if (freq === "D") date.setDate(date.getDate() + 1);
  else if (freq === "W") date.setDate(date.getDate() + 7);
  else if (freq === "M") date.setMonth(date.getMonth() + 1);
  return date.toISOString().split("T")[0];
}

module.exports = router;