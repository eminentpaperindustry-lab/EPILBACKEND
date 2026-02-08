const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { parser } = require("../cloudinary"); // multer + cloudinary

const router = express.Router();
const SHEET_NAME = "SupportTicketsMaster";

// ======================================================
// TICKET ID GENERATOR → ST + 4 random digits
// ======================================================
const generateTicketID = () => {
  const random4Digit = Math.floor(1000 + Math.random() * 9000);
  return `ST${random4Digit}`;
};

// ======================================================
// DATE FORMATTER → dd/mm/yyyy hh:mm:ss (IST)
// ======================================================
function formatDateDDMMYYYYHHMMSS(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(utc + istOffset);

  const dd = String(istDate.getDate()).padStart(2, "0");
  const mm = String(istDate.getMonth() + 1).padStart(2, "0");
  const yyyy = istDate.getFullYear();
  const hh = String(istDate.getHours()).padStart(2, "0");
  const min = String(istDate.getMinutes()).padStart(2, "0");
  const ss = String(istDate.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`; // clean string, no commas, no quotes
}

/* ================= CREATE TICKET ================= */
router.post("/create", auth, parser.single("IssuePhoto"), async (req, res) => {
  try {
    const { Issue } = req.body;

    if (!Issue)
      return res.status(400).json({ error: "Issue required" });

    const sheets = await getSheets();
    const createdDate = formatDateDDMMYYYYHHMMSS(); // IST
    const status = "Pending";
    const photoUrl = req.file ? req.file.path : "";

    // Get all employees
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:H",
    });

    const employees = empRes.data.values || [];
    
    // Filter MIS employees only
    const misEmployees = employees.filter(emp => emp[4] === "MIS");
    
    if (misEmployees.length === 0) {
      return res.status(400).json({ error: "No MIS employees found" });
    }

    // Create tickets for each MIS employee
    const ticketIDs = [];
    
    for (const emp of misEmployees) {
      const ticketID = generateTicketID();
      const empName = emp[1]; // Adjust based on your sheet structure
      
      // Skip if assigning to self
      if (empName === req.user.name) {
        continue;
      }
      
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
        range: `${SHEET_NAME}!A:H`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              ticketID,
              req.user.name, // Creator
              empName, // Assigned to MIS employee
              Issue,
              status,
              createdDate,
              "",
              photoUrl,
            ],
          ],
        },
      });
      
      ticketIDs.push(ticketID);
    }

    if (ticketIDs.length === 0) {
      return res.status(400).json({ error: "Cannot assign tickets only to yourself" });
    }

    res.json({ 
      ok: true, 
      ticketIDs,
      message: `${ticketIDs.length} ticket(s) created for MIS team` 
    });

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
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:H`,
    });

    const rows = data.data.values || [];
    const tickets = rows
      .filter((r) => r[1] === req.user.name)
      .map((r) => ({
        TicketID: r[0],
        CreatedBy: r[1],
        AssignedTo: r[2],
        Issue: r[3],
        Status: r[4],
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
      }));

    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET ASSIGNED TICKETS ================= */
router.get("/assigned", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:H`,
    });

    const rows = data.data.values || [];
    const tickets = rows
      .filter((r) => r[2] === req.user.name)
      .map((r) => ({
        TicketID: r[0],
        CreatedBy: r[1],
        AssignedTo: r[2],
        Issue: r[3],
        Status: r[4],
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
      }));

    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET TICKETS WITH OPTIONAL FILTERS ================= */
router.get("/all", auth, async (req, res) => {
  try {
    const { assignedTo, createdBy, status } = req.query;

    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:H`,
    });

    const rows = data.data.values || [];

    const tickets = rows
      .filter((r) => {
        let ok = true;
        if (assignedTo) ok = ok && r[2] === assignedTo;
        if (createdBy) ok = ok && r[1] === createdBy;
        if (status) ok = ok && r[4] === status;
        return ok;
      })
      .map((r) => ({
        TicketID: r[0],
        CreatedBy: r[1],
        AssignedTo: r[2],
        Issue: r[3],
        Status: r[4],
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
      }));

    res.json({ ok: true, tickets });
  } catch (err) {
    console.error("FILTER TICKETS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});


router.get("/filter", auth, async (req, res) => {
  try {
    const { month, week ,selectedName } = req.query;
    if (!month || !week) {
      return res.status(400).json({ error: "Month and Week are required" });
    }

    const userName = req.user.name.trim().toLowerCase();

    // ---------------- FETCH SHEET ----------------
    const sheets = await getSheets();
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:H`, // Range for your checklist data
    });

    const rows = sheetRes.data.values || [];

    // ---------------- DATE HELPERS ----------------
    function parseDDMMYYYY(str) {
      if (!str) return null;
      const p = str.split(" ")[0].split("/"); // Ignore the time part
      if (p.length !== 3) return null;
      const [d, m, y] = p;
      const year = y.length === 2 ? 2000 + +y : +y;
      return new Date(year, +m - 1, +d);
    }

    function workingDaysBetween(start, end) {
      let count = 0;
      const cur = new Date(start);
      while (cur <= end) {
        const day = cur.getDay();
        if (day !== 0 && day !== 6) count++;  // Exclude weekends
        cur.setDate(cur.getDate() + 1);
      }
      return count - 1;
    }

    // ---------------- WEEK RANGE ----------------
    const year = new Date().getFullYear();  // Get the current year dynamically
    const selectedMonth = Number(month) - 1; // JS month is 0-based

    // Function to get the start date of the week (Monday)
    function getWeekStartDate(weekNum, month, year) {
      const firstDay = new Date(year, month, 1);
      const dow = firstDay.getDay();
      const diff = dow === 0 ? 1 : 8 - dow;  // Adjust to Monday
      return new Date(year, month, 1 + diff + (weekNum - 2) * 7);
    }

    const weekStart = getWeekStartDate(Number(week), selectedMonth, year);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);  // Sunday of the same week
console.log("Support Ticket weekStart : ", weekStart , "weekEnd : " , weekEnd);


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

        // ✅ TOTAL CONDITION (Check if the ticket should be counted)
        const shouldCount =
          createdDate <= weekEnd && (!doneDate || doneDate >= weekStart);

        if (!shouldCount) return;

        total++;

        // ✅ COMPLETED
        if (doneDate && doneDate >= weekStart && doneDate <= weekEnd) {
          completed++;

          const wd = workingDaysBetween(createdDate, doneDate);
          if (wd > 3) delayed++;  // Consider as delayed if it took more than 3 working days
        }
        // ✅ PENDING
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
        delayedPercentage: total ? ((delayed / total) * 100).toFixed(2) : "0.00",
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
// router.patch("/status/:ticketID", auth, async (req, res) => {
//   try {
//     const { Status } = req.body;
//     if (!Status) return res.status(400).json({ error: "Status required" });

//     const sheets = await getSheets();
//     const data = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
//       range: `${SHEET_NAME}!A2:H`,
//     });

//     const rows = data.data.values || [];
//     const index = rows.findIndex((r) => r[0] === req.params.ticketID);
//     if (index === -1) return res.status(404).json({ error: "Ticket not found" });

//     const ticket = rows[index];
//     ticket[4] = Status;
//     ticket[6] =
//       Status === "Done" ? formatDateDDMMYYYYHHMMSS() : ""; // clean DoneDate

//     await sheets.spreadsheets.values.update({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
//       range: `${SHEET_NAME}!A${index + 2}:H${index + 2}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: [ticket] },
//     });

//     res.json({ ok: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

router.patch("/status/:ticketID", auth, async (req, res) => {
  try {
    const { Status } = req.body;
    if (!Status) return res.status(400).json({ error: "Status required" });

    const sheets = await getSheets();
    
    // Debug logging
    console.log(`Looking for ticket ID: ${req.params.ticketID}`);
    console.log(`New status: ${Status}`);

    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:H`,
    });

    const rows = data.data.values || [];
    console.log(`Total rows in sheet: ${rows.length}`);
    
    // Find all matching tickets
    const matchingTickets = [];
    let foundTicket = null;
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // First find the ticket by ID
      if (row[0] === req.params.ticketID) {
        foundTicket = { row, index: i };
      }
    }
    
    if (!foundTicket) {
      console.log("Ticket not found by ID");
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticketName = foundTicket.row[3];
    console.log(`Found ticket name: "${ticketName}" at row ${foundTicket.index + 2}`);
    
    if (!ticketName) {
      return res.status(400).json({ error: "Ticket name not found" });
    }

    // Now find all tickets with same name
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row[3] && row[3].trim() === ticketName.trim()) {
        matchingTickets.push({ row, index: i });
        console.log(`Matching ticket found at row ${i + 2}: ${row[0]} - ${row[3]}`);
      }
    }

    console.log(`Total matching tickets: ${matchingTickets.length}`);

    const doneDate = Status === "Done" ? formatDateDDMMYYYYHHMMSS() : "";
    
    // Update each matching ticket
    for (const ticket of matchingTickets) {
      const rowNum = ticket.index + 2;
      console.log(`Updating row ${rowNum}...`);
      
      try {
        // Update the entire row with new values
        const updatedRow = [...ticket.row];
        updatedRow[4] = Status; // Status column
        updatedRow[6] = doneDate; // DoneDate column
        
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
          range: `${SHEET_NAME}!A${rowNum}:H${rowNum}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [updatedRow] },
        });
        
        console.log(`Successfully updated row ${rowNum}`);
      } catch (err) {
        console.error(`Failed to update row ${rowNum}:`, err.message);
      }
    }

    res.json({ 
      ok: true, 
      message: `Updated ${matchingTickets.length} ticket(s) with issue "${ticketName}"`,
      updatedCount: matchingTickets.length,
      ticketName: ticketName
    });

  } catch (err) {
    console.error("UPDATE TICKET STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
