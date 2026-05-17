// ============================================================
// CENTRALIZED DATE UTILITIES
// Eliminates 10+ duplicated date formatting functions
// across auth.js, delegations.js, checklist.js, supportTickets.js, helpTickets.js
// ============================================================

/**
 * Format date to DD/MM/YYYY HH:mm:ss (IST)
 */
function formatDateIST(date = new Date()) {
  // Convert to IST (UTC + 5:30)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utc + istOffset);

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(istDate.getDate())}/${pad(istDate.getMonth() + 1)}/${istDate.getFullYear()} ${pad(istDate.getHours())}:${pad(istDate.getMinutes())}:${pad(istDate.getSeconds())}`;
}

/**
 * Format date to DD/MM/YYYY
 */
function formatDateDMY(date) {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Parse DD/MM/YYYY or DD/MM/YYYY HH:mm:ss to Date object
 */
function parseDDMMYYYY(str) {
  if (!str) return null;
  const parts = str.split(" ")[0].split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(m) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Parse DD/MM/YYYY to YYYY-MM-DD format
 */
function parseDateFromDMY(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return null;
}

/**
 * Get week range (Monday 00:00 - Sunday 23:59) for a given month and week number
 */
function getWeekRange(month, week, year = new Date().getFullYear()) {
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
    weekStart.setDate(firstMonday.getDate() + (Number(week) - 1) * 7);
    weekStart.setHours(0, 0, 0, 0);

    weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
  }

  return { weekStart, weekEnd };
}

module.exports = {
  formatDateIST,
  formatDateDMY,
  parseDDMMYYYY,
  parseDateFromDMY,
  getWeekRange,
};