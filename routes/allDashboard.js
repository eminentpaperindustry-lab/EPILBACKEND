const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { getSheets } = require("../googleSheetsClient");
const { parseDDMMYYYY, getWeekRange } = require("../utils/dateHelpers");

// ============================================================
// CALCULATION HELPERS (inlined for performance)
// ============================================================
function percent(part, total) {
  return total ? ((part / total) * 100).toFixed(2) : "0.00";
}

function delegationCalc(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[1]?.trim().toLowerCase() || "") !== empName) return;
    const created = parseDDMMYYYY(r[3]);
    const deadline = parseDDMMYYYY(r[4]);
    const done = r[7] ? parseDDMMYYYY(r[7]) : null;
    if (!created || !(created <= weekEnd && (!done || done >= weekStart))) return;
    total++;
    if (done && done >= weekStart && done <= weekEnd) {
      completed++;
      deadline && done <= deadline ? onTime++ : delayed++;
    } else { pending++; }
  });

  return { totalWork: total, completedWork: completed, pendingWork: pending, onTimeWork: onTime, pendingPercent: percent(pending, total), delayPercent: percent(delayed, completed) };
}

function checklistCalc(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[0]?.trim().toLowerCase() || "") !== empName) return;
    const planned = parseDDMMYYYY(r[6]);
    const actual = parseDDMMYYYY(r[7]);
    const inRange = (planned && planned >= weekStart && planned <= weekEnd) || (actual && actual >= weekStart && actual <= weekEnd);
    if (!inRange) return;
    total++;
    if (actual) { completed++; planned && actual <= planned ? onTime++ : delayed++; }
    else { pending++; }
  });

  return { totalWork: total, completedWork: completed, pendingWork: pending, onTimeWork: onTime, pendingPercent: percent(pending, total), delayPercent: percent(delayed, completed) };
}

function ticketCalc(rows, name, weekStart, weekEnd, colIdx = 2) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[colIdx]?.trim().toLowerCase() || "") !== empName) return;
    const created = parseDDMMYYYY(r[5]);
    const done = parseDDMMYYYY(r[6]);
    if (!created || !(created <= weekEnd && (!done || done >= weekStart))) return;
    total++;
    if (done && done >= weekStart && done <= weekEnd) {
      completed++;
      const days = Math.ceil((done - created) / (1000 * 60 * 60 * 24));
      days <= 3 ? onTime++ : delayed++;
    } else { pending++; }
  });

  return { totalWork: total, completedWork: completed, pendingWork: pending, onTimeWork: onTime, pendingPercent: percent(pending, total), delayPercent: percent(delayed, completed) };
}

// ============================================================
// MAIN DASHBOARD API - PARALLEL SHEET READS
// ============================================================
router.get("/all-dashboard", auth, asyncHandler(async (req, res) => {
  const { month, week, selectedName } = req.query;
  if (!month || !week) return res.status(400).json({ error: "Month & Week required" });

  const { weekStart, weekEnd } = getWeekRange(month, week);
  const sheets = await getSheets();

  // PARALLEL: Fetch ALL data simultaneously instead of sequentially
  const [
    empRes,
    delegationRes,
    checklistRes,
    helpRes,
    supportRes
  ] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID, range: "Employee!A2:H",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION, range: "DelegationMaster!A2:R",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST, range: "Master!A2:K",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET, range: "HelpTicketsMaster!A2:H",
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET, range: "SupportTicketsMaster!A2:H",
    }),
  ]);

  const delegationRows = delegationRes.data.values || [];
  const checklistRows = checklistRes.data.values || [];
  const helpRows = helpRes.data.values || [];
  const supportRows = supportRes.data.values || [];

  let employees = (empRes.data.values || []).map(e => ({
    name: e[1]?.trim(),
    key: e[1]?.trim().toLowerCase(),
  }));

  if (selectedName && selectedName !== "all") {
    employees = employees.filter(e => e.key === selectedName.trim().toLowerCase());
  }

  const data = [];
  for (const emp of employees) {
    const nameKey = emp.key;

    const delegation = delegationCalc(delegationRows, nameKey, weekStart, weekEnd);
    const checklist = checklistCalc(checklistRows, nameKey, weekStart, weekEnd);
    const helpTicket = ticketCalc(helpRows, nameKey, weekStart, weekEnd, 2);
    const helpTicketCreated = ticketCalc(helpRows, nameKey, weekStart, weekEnd, 1);
    const supportTicket = ticketCalc(supportRows, nameKey, weekStart, weekEnd, 2);
    const supportTicketCreated = ticketCalc(supportRows, nameKey, weekStart, weekEnd, 1);

    const totalWork = delegation.totalWork + checklist.totalWork + helpTicket.totalWork + supportTicket.totalWork;
    const totalCompleted = delegation.completedWork + checklist.completedWork + helpTicket.completedWork + supportTicket.completedWork;
    const totalPending = delegation.pendingWork + checklist.pendingWork + helpTicket.pendingWork + supportTicket.pendingWork;
    const totalOnTime = delegation.onTimeWork + checklist.onTimeWork + helpTicket.onTimeWork + supportTicket.onTimeWork;
    const pendingPercent = percent(totalPending, totalWork);
    const delayPercent = ((Number(delegation.delayPercent) + Number(checklist.delayPercent) + Number(helpTicket.delayPercent) + Number(supportTicket.delayPercent)) / 4).toFixed(2);

    data.push({
      name: emp.name,
      delegation,
      checklist,
      helpTicket: {
        assigned: { totalWork: helpTicket.totalWork, completedWork: helpTicket.completedWork, pendingWork: helpTicket.pendingWork, onTimeWork: helpTicket.onTimeWork, pendingPercent: helpTicket.pendingPercent, delayPercent: helpTicket.delayPercent },
        created: { totalWork: helpTicketCreated.totalWork, completedWork: helpTicketCreated.completedWork, pendingWork: helpTicketCreated.pendingWork, onTimeWork: helpTicketCreated.onTimeWork, pendingPercent: helpTicketCreated.pendingPercent, delayPercent: helpTicketCreated.delayPercent },
      },
      supportTicket: {
        assigned: { totalWork: supportTicket.totalWork, completedWork: supportTicket.completedWork, pendingWork: supportTicket.pendingWork, onTimeWork: supportTicket.onTimeWork, pendingPercent: supportTicket.pendingPercent, delayPercent: supportTicket.delayPercent },
        created: { totalWork: supportTicketCreated.totalWork, completedWork: supportTicketCreated.completedWork, pendingWork: supportTicketCreated.pendingWork, onTimeWork: supportTicketCreated.onTimeWork, pendingPercent: supportTicketCreated.pendingPercent, delayPercent: supportTicketCreated.delayPercent },
      },
      overall: {
        totalWork, totalCompleted, totalPending, totalOnTime,
        pendingPercent, delayPercent,
        overallScore: ((Number(pendingPercent) * 0.8 + Number(delayPercent) * 0.2)).toFixed(2),
      },
    });
  }

  res.json({ weekStart: weekStart.toLocaleDateString("en-CA"), weekEnd: weekEnd.toLocaleDateString("en-CA"), data });
}));

module.exports = router;