const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { parser } = require("../cloudinary");

const router = express.Router();
const SHEET_NAME = "HelpTicketsMaster";

const generateTicketID = () => {
  const random4Digit = Math.floor(1000 + Math.random() * 9000);
  return `HT${random4Digit}`;
};


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

/* ================= CREATE TICKET ================= */
router.post("/create", auth, parser.single("IssuePhoto"), async (req, res) => {
  try {
    const { AssignedTo, Issue } = req.body;
    if (!AssignedTo || !Issue) return res.status(400).json({ error: "AssignedTo and Issue required" });
    if (AssignedTo === req.user.name) return res.status(400).json({ error: "Cannot assign ticket to yourself" });

    const sheets = await getSheets();
    // const ticketID = nanoid(6);
    const ticketID =generateTicketID();

    const createdDate = formatDateDDMMYYYYHHMMSS();
    const status = "Pending";
    const photoUrl = req.file ? req.file.path : "";

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[ticketID, req.user.name, AssignedTo, Issue, status, createdDate, "", photoUrl]]
      }
    });

    res.json({ ok: true, ticketID });
  } catch (err) {
    console.error("CREATE TICKET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET CREATED TICKETS ================= */
router.get("/created", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A2:H`
    });

    console.log("req.user.name:",req.user.name);
    
    const rows = data.data.values || [];
    const tickets = rows.filter(r => r[1] === req.user.name).map(r => ({
      TicketID: r[0], CreatedBy: r[1], AssignedTo: r[2], Issue: r[3],
      Status: r[4], CreatedDate: r[5], DoneDate: r[6] || "", IssuePhoto: r[7] || ""
    }));

    console.log("tickets:", tickets ,rows );
    
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= GET ASSIGNED TICKETS ================= */
router.get("/assigned", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A2:H`
    });
    const rows = data.data.values || [];
    const tickets = rows.filter(r => r[2] === req.user.name).map(r => ({
      TicketID: r[0], CreatedBy: r[1], AssignedTo: r[2], Issue: r[3],
      Status: r[4], CreatedDate: r[5], DoneDate: r[6] || "", IssuePhoto: r[7] || ""
    }));
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= GET TICKETS WITH OPTIONAL FILTERS ================= */
router.get("/all", auth, async (req, res) => {
  try {
    const { assignedTo, createdBy, status } = req.query;

    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A2:H`
    });

    const rows = data.data.values || [];

    const tickets = rows.filter(r => {
      let ok = true;
      if (assignedTo) ok = ok && r[2] === assignedTo;
      if (createdBy) ok = ok && r[1] === createdBy;
      if (status) ok = ok && r[4] === status;
      return ok;
    }).map(r => ({
      TicketID: r[0],
      CreatedBy: r[1],
      AssignedTo: r[2],
      Issue: r[3],
      Status: r[4],
      CreatedDate: r[5],
      DoneDate: r[6] || "",
      IssuePhoto: r[7] || ""
    }));

    res.json({ ok: true, tickets });
  } catch (err) {
    console.error("FILTER TICKETS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

router.get("/filter", auth, async (req, res) => {
  try {
    const { month, week,selectedName } = req.query;
    if (!month || !week) {
      return res.status(400).json({ error: "Month and Week are required" });
    }

    const userName = req.user.name.trim().toLowerCase();

    // ---------------- FETCH SHEET ----------------
    const sheets = await getSheets();
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A2:H`,
    });

    const rows = sheetRes.data.values || [];

    // ---------------- DATE HELPERS ----------------
    function parseDDMMYYYY(str) {
      if (!str) return null;
      const p = str.split(" ")[0].split("/");
      if (p.length !== 3) return null;
      const [d, m, y] = p;
      const year = y.length === 2 ? 2000 + +y : +y;
      const date = new Date(year, +m - 1, +d);
      return isNaN(date.getTime()) ? null : date;
    }

    function workingDaysBetween(start, end) {
      let count = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) count++;
        cur.setDate(cur.getDate() + 1);
      }
      return count - 1;
    }

    // ---------------- CALCULATE DATE RANGE ----------------
    const currentYear = new Date().getFullYear();
    const selectedMonth = Number(month) - 1;
    let weekStart, weekEnd;

    if (week === "all") {
      // Logic: First to Last Day of the Month
      weekStart = new Date(currentYear, selectedMonth, 1);
      weekStart.setHours(0, 0, 0, 0);

      weekEnd = new Date(currentYear, selectedMonth + 1, 0);
      weekEnd.setHours(23, 59, 59, 999);
    } else {
      // Logic: Strictly Monday to Sunday
      const firstDayOfMonth = new Date(currentYear, selectedMonth, 1);
      const dayName = firstDayOfMonth.getDay(); // 0=Sun, 1=Mon

      // Find Monday of Week 1
      const diffToMonday = (dayName === 0) ? -6 : 1 - dayName;
      const firstMonday = new Date(currentYear, selectedMonth, 1 + diffToMonday);

      // Jump to selected week
      weekStart = new Date(firstMonday);
      weekStart.setDate(firstMonday.getDate() + (Number(week) - 1) * 7);
      weekStart.setHours(0, 0, 0, 0);

      // End on Sunday
      weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
    }

    // ---------------- CORE LOGIC ----------------
    function calculateTickets(filteredRows) {
      let total = 0;
      let pending = 0;
      let completed = 0;
      let delayed = 0;
      const tickets = [];

      filteredRows.forEach((r) => {
        const createdDate = parseDDMMYYYY(r[5]);
        const doneDate = parseDDMMYYYY(r[6]);
        if (!createdDate) return;

        // Condition for Total Tickets Active in this Range
        const shouldCount = createdDate <= weekEnd && (!doneDate || doneDate >= weekStart);

        if (!shouldCount) return;

        total++;

        // Ticket Completed WITHIN this Range
        if (doneDate && doneDate >= weekStart && doneDate <= weekEnd) {
          completed++;
          const wd = workingDaysBetween(createdDate, doneDate);
          if (wd > 3) delayed++;
        } 
        // Ticket is still Pending (or completed after this range)
        else {
          pending++;
        }

        tickets.push({
          TicketID: r[0],
          CreatedBy: r[1],
          AssignedTo: r[2],
          Issue: r[3],
          Status: r[4],
          CreatedDate: r[5],
          DoneDate: r[6] || ""
        });
      });

      return {
        total,
        pending,
        completed,
        delayed,
        pendingPercentage: total ? ((pending / total) * 100).toFixed(2) : "0.00",
        delayedPercentage: completed ? ((delayed / completed) * 100).toFixed(2) : "0.00",
        tickets
      };
    }
// Determine which name to filter by
const nameToFilter = selectedName && selectedName.trim()
  ? selectedName.trim().toLowerCase()
  : userName;

// Filter rows
const assignedRows = rows.filter(
  (r) => r[2]?.trim().toLowerCase() === nameToFilter
);

const createdRows = rows.filter(
  (r) => r[1]?.trim().toLowerCase() === nameToFilter
);


    const assignedData = calculateTickets(assignedRows);
    const createdData = calculateTickets(createdRows);
console.log("Help ticket weekStart : ", weekStart , "weekEnd : " , weekEnd);

    // ---------------- RESPONSE ----------------
    res.json({
      weekStart: weekStart.toLocaleDateString('en-CA'),
      weekEnd: weekEnd.toLocaleDateString('en-CA'),
      assigned: {
        assignedTotalTicket: assignedData.total,
        assignedPendingTicket: assignedData.pending,
        assignedCompletedTicket: assignedData.completed,
        assignedDelayedTicket: assignedData.delayed,
        assignedPendingPercentage: assignedData.pendingPercentage,
        assignedDelayPercentage: assignedData.delayedPercentage,
        tickets: assignedData.tickets
      },
      created: {
        createdTotalTicket: createdData.total,
        createdPendingTicket: createdData.pending,
        createdCompletedTicket: createdData.completed,
        createdDelayedTicket: createdData.delayed,
        createdPendingPercentage: createdData.pendingPercentage,
        createdDelayPercentage: createdData.delayedPercentage,
        tickets: createdData.tickets
      }
    });

  } catch (err) {
    console.error("Support Ticket Filter Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= UPDATE STATUS ================= */
router.patch("/status/:ticketID", auth, async (req, res) => {
  try {
    const { Status } = req.body;
    if (!Status) return res.status(400).json({ error: "Status required" });

    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A2:H`
    });
    const rows = data.data.values || [];
    const index = rows.findIndex(r => r[0] === req.params.ticketID);
    if (index === -1) return res.status(404).json({ error: "Ticket not found" });

    const ticket = rows[index];
    ticket[4] = Status;
    ticket[6] = Status === "Done" ? formatDateDDMMYYYYHHMMSS() : ""; // IST DoneDate

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_HELPTICKET,
      range: `${SHEET_NAME}!A${index+2}:H${index+2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [ticket] }
    });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});





module.exports = router;
