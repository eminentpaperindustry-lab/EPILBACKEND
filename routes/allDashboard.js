const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { getSheets } = require("../googleSheetsClient");

/* ===================== HELPERS ===================== */

function parseDDMMYYYY(str) {
  if (!str) return null;
  const p = str.split(" ")[0].split("/");
  if (p.length !== 3) return null;
  const [d, m, y] = p;
  const year = y.length === 2 ? 2000 + +y : +y;
  const date = new Date(year, +m - 1, +d);
  return isNaN(date.getTime()) ? null : date;
}

function percent(part, total) {
  return total ? ((part / total) * 100).toFixed(2) : "0.00";
}

function calculate80_20(pendingPercent, delayPercent) {
  return (Number(pendingPercent) * 0.8 + Number(delayPercent) * 0.2).toFixed(2);
}

function getWeekRange(month, week) {
  const year = new Date().getFullYear();
  const m = Number(month) - 1;
  let weekStart, weekEnd;

  if (week === "all") {
    weekStart = new Date(year, m, 1);
    weekStart.setHours(0, 0, 0, 0);
    weekEnd = new Date(year, m + 1, 0);
    weekEnd.setHours(23, 59, 59, 999);
  } else {
    const firstDay = new Date(year, m, 1);
    const dow = firstDay.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const firstMonday = new Date(year, m, 1 + diff);

    weekStart = new Date(firstMonday);
    weekStart.setDate(firstMonday.getDate() + (week - 1) * 7);
    weekStart.setHours(0, 0, 0, 0);

    weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
  }

  return { weekStart, weekEnd };
}

/* ===================== CALCULATORS ===================== */

// Delegation Calculation
function delegationCalc(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[1]?.trim().toLowerCase() || "") !== empName) return;

    const created = parseDDMMYYYY(r[3]);
    const deadline = parseDDMMYYYY(r[4]);
    const done = r[7] ? parseDDMMYYYY(r[7]) : null;

    if (!created) return;
    if (!(created <= weekEnd && (!done || done >= weekStart))) return;

    total++;

    if (done && done >= weekStart && done <= weekEnd) {
      completed++;
      if (deadline && done <= deadline) onTime++;
      else delayed++;
    } else {
      pending++;
    }
  });

  return {
    totalWork: total,
    completedWork: completed,
    pendingWork: pending,
    onTimeWork: onTime,
    pendingPercent: percent(pending, total),
    delayPercent: percent(delayed, completed),
  };
}

// Checklist Calculation
function checklistCalc(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[0]?.trim().toLowerCase() || "") !== empName) return;

    const planned = parseDDMMYYYY(r[6]);
    const actual = parseDDMMYYYY(r[7]);

    const inRange =
      (planned && planned >= weekStart && planned <= weekEnd) ||
      (actual && actual >= weekStart && actual <= weekEnd);

    if (!inRange) return;

    total++;

    if (actual) {
      completed++;
      if (planned && actual <= planned) onTime++;
      else delayed++;
    } else {
      pending++;
    }
  });

  return {
    totalWork: total,
    completedWork: completed,
    pendingWork: pending,
    onTimeWork: onTime,
    pendingPercent: percent(pending, total),
    delayPercent: percent(delayed, completed),
  };
}

// Ticket Calculation (HelpTicket and SupportTicket)
function ticketCalc(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[2]?.trim().toLowerCase() || "") !== empName) return;

    const created = parseDDMMYYYY(r[5]);
    const done = parseDDMMYYYY(r[6]);
    if (!created) return;

    if (!(created <= weekEnd && (!done || done >= weekStart))) return;

    total++;

    if (done && done >= weekStart && done <= weekEnd) {
      completed++;
      const days = Math.ceil((done - created) / (1000 * 60 * 60 * 24));
      if (days <= 3) onTime++;
      else delayed++;
    } else {
      pending++;
    }
  });

  return {
    totalWork: total,
    completedWork: completed,
    pendingWork: pending,
    onTimeWork: onTime,
    pendingPercent: percent(pending, total),
    delayPercent: percent(delayed, completed),
  };
}

function ticketCalcCreated(rows, name, weekStart, weekEnd) {
  const empName = name.trim().toLowerCase();
  let total = 0, completed = 0, pending = 0, onTime = 0, delayed = 0;

  rows.forEach(r => {
    if ((r[1]?.trim().toLowerCase() || "") !== empName) return;

    const created = parseDDMMYYYY(r[5]);
    const done = parseDDMMYYYY(r[6]);
    if (!created) return;

    if (!(created <= weekEnd && (!done || done >= weekStart))) return;

    total++;

    if (done && done >= weekStart && done <= weekEnd) {
      completed++;
      const days = Math.ceil((done - created) / (1000 * 60 * 60 * 24));
      if (days <= 3) onTime++;
      else delayed++;
    } else {
      pending++;
    }
  });

  return {
    totalWork: total,
    completedWork: completed,
    pendingWork: pending,
    onTimeWork: onTime,
    pendingPercent: percent(pending, total),
    delayPercent: percent(delayed, completed),
  };
}

/* ===================== API ===================== */

router.get("/all-dashboard", auth, async (req, res) => {
  try {
    const { month, week, selectedName } = req.query;
    if (!month || !week) {
      return res.status(400).json({ error: "Month & Week required" });
    }

    const sheets = await getSheets();
    const { weekStart, weekEnd } = getWeekRange(month, week);

    // EMPLOYEES
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:H",
    });

    let employees = (empRes.data.values || []).map(e => ({
      name: e[1]?.trim(),
      key: e[1]?.trim().toLowerCase(),
    }));

    // FILTER EMPLOYEE IF selectedName PROVIDED
    if (selectedName && selectedName !== "all") {
      employees = employees.filter(e => e.key === selectedName.trim().toLowerCase());
    }

    // ALL DATA
    const delegationRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: "DelegationMaster!A2:R",
    })).data.values || [];

    const checklistRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: "Master!A2:K",
    })).data.values || [];

    const helpRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: "HelpTicketsMaster!A2:H",
    })).data.values || [];

    const supportRows = (await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: "SupportTicketsMaster!A2:H",
    })).data.values || [];

    const data = [];

    for (const emp of employees) {
      const nameKey = emp.key;

      const delegation = delegationCalc(delegationRows, nameKey, weekStart, weekEnd);
      const checklist = checklistCalc(checklistRows, nameKey, weekStart, weekEnd);
      const helpTicket = ticketCalc(helpRows, nameKey, weekStart, weekEnd);
      const supportTicket = ticketCalc(supportRows, nameKey, weekStart, weekEnd);
const helpTicketCrated = ticketCalcCreated(helpRows, nameKey, weekStart, weekEnd);
      const supportTicketCreated = ticketCalcCreated(supportRows, nameKey, weekStart, weekEnd);

      const totalWork =
        delegation.totalWork +
        checklist.totalWork +
        helpTicket.totalWork +
        supportTicket.totalWork;

      const totalCompleted =
        delegation.completedWork +
        checklist.completedWork +
        helpTicket.completedWork +
        supportTicket.completedWork;

      const totalPending =
        delegation.pendingWork +
        checklist.pendingWork +
        helpTicket.pendingWork +
        supportTicket.pendingWork;

      const totalOnTime =
        delegation.onTimeWork +
        checklist.onTimeWork +
        helpTicket.onTimeWork +
        supportTicket.onTimeWork;

      const pendingPercent = percent(totalPending, totalWork);

      const delayPercent =
        (Number(delegation.delayPercent) +
         Number(checklist.delayPercent) +
         Number(helpTicket.delayPercent) +
         Number(supportTicket.delayPercent)) / 4;

      data.push({
        name: emp.name,
        delegation,
        checklist,
        helpTicket: {
          assigned: {
            totalWork: helpTicket.totalWork,
            completedWork: helpTicket.completedWork,
            pendingWork: helpTicket.pendingWork,
            onTimeWork: helpTicket.onTimeWork,
            pendingPercent: helpTicket.pendingPercent,
            delayPercent: helpTicket.delayPercent,
          },
          created: {
            totalWork: helpTicketCrated.totalWork,
            completedWork: helpTicketCrated.completedWork,
            pendingWork: helpTicketCrated.pendingWork,
            onTimeWork: helpTicketCrated.onTimeWork,
            pendingPercent: helpTicketCrated.pendingPercent,
            delayPercent: helpTicketCrated.delayPercent,
          },
        },
        supportTicket: {
          assigned: {
            totalWork: supportTicket.totalWork,
            completedWork: supportTicket.completedWork,
            pendingWork: supportTicket.pendingWork,
            onTimeWork: supportTicket.onTimeWork,
            pendingPercent: supportTicket.pendingPercent,
            delayPercent: supportTicket.delayPercent,
          },
          created: {
            totalWork: supportTicketCreated.totalWork,
            completedWork: supportTicketCreated.completedWork,
            pendingWork: supportTicketCreated.pendingWork,
            onTimeWork: supportTicketCreated.onTimeWork,
            pendingPercent: supportTicketCreated.pendingPercent,
            delayPercent: supportTicketCreated.delayPercent,
          },
        },
        overall: {
          totalWork,
          totalCompleted,
          totalPending,
          totalOnTime,
          pendingPercent,
          delayPercent: delayPercent.toFixed(2),
          overallScore: calculate80_20(pendingPercent, delayPercent),
        },
      });
    }

    res.json({
      weekStart: weekStart.toLocaleDateString("en-CA"),
      weekEnd: weekEnd.toLocaleDateString("en-CA"),
      data,
    });
  } catch (err) {
    console.error("ALL DASHBOARD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
