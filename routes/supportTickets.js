const express = require("express");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { parser } = require("../cloudinary");

const router = express.Router();
const SHEET_NAME = "SupportTicketsMaster";

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

  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

/* ================= TEST ROUTES ================= */
router.get("/test", (req, res) => {
  res.json({ message: "Support tickets route working", timestamp: new Date() });
});

router.get("/test-auth", auth, (req, res) => {
  res.json({ message: "Auth working", user: req.user });
});

/* ================= CREATE TICKET ================= */
router.post("/create", auth, parser.single("IssuePhoto"), async (req, res) => {
  try {
    console.log("CREATE TICKET - User:", req.user);
    console.log("CREATE TICKET - Body:", req.body);
    
    const { Issue } = req.body;

    if (!Issue) {
      return res.status(400).json({ error: "Issue description is required" });
    }

    const sheets = await getSheets();
    const createdDate = formatDateDDMMYYYYHHMMSS();
    const photoUrl = req.file ? req.file.path : "";

    // Get all employees
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:H",
    });

    const employees = empRes.data.values || [];
    
    // Filter MIS employees only (exclude self)
    const misEmployees = employees.filter(emp => emp[4] === "MIS" && emp[1] !== req.user.name);
    
    if (misEmployees.length === 0) {
      return res.status(400).json({ error: "No MIS employees found to assign tickets" });
    }

    // Get the last ticket ID
    const lastIdRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A:A`,
    });

    const allIds = lastIdRes.data.values || [];
    let lastId = "#00000";
    
    if (allIds.length > 1) {
      const lastRow = allIds[allIds.length - 1];
      if (lastRow && lastRow[0]) {
        lastId = lastRow[0];
      }
    }

    // Generate next ID
    let nextIdNumber = 1;
    if (lastId !== "#00000") {
      const numStr = lastId.substring(1);
      nextIdNumber = parseInt(numStr, 10) + 1;
    }
    
    // Create tickets for each MIS employee
    const ticketIDs = [];
    const errors = [];
    
    for (const emp of misEmployees) {
      try {
        const empName = emp[1];
        const ticketID = `#${String(nextIdNumber).padStart(5, '0')}`;
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
          range: `${SHEET_NAME}!A:Z`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              ticketID,           // A: TicketID
              req.user.name,       // B: CreatedBy
              empName,             // C: AssignedTo
              Issue,               // D: Issue
              "Pending",           // E: Status
              createdDate,         // F: CreatedDate
              "",                  // G: DoneDate
              photoUrl,            // H: Issuephoto
              "",                  // I: WorkBy
              "Pending",           // J: Taskcompletedapproval
            ]],
          },
        });
        
        ticketIDs.push(ticketID);
        nextIdNumber++;
      } catch (err) {
        console.error(`Error creating ticket for ${emp[1]}:`, err);
        errors.push(`Failed for ${emp[1]}`);
      }
    }

    if (ticketIDs.length === 0) {
      return res.status(500).json({ error: "Failed to create any tickets", details: errors });
    }

    res.json({ 
      ok: true, 
      ticketIDs: ticketIDs,
      message: `${ticketIDs.length} ticket(s) created successfully`,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error("CREATE TICKET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET CREATED TICKETS ================= */
router.get("/created", auth, async (req, res) => {
  try {
    console.log("GET CREATED - User:", req.user.name);
    
    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:Z`,
    });

    const rows = data.data.values || [];
    
    const tickets = rows
      .filter((r) => r[1] === req.user.name)
      .map((r) => ({
        TicketID: r[0] || "",
        CreatedBy: r[1] || "",
        AssignedTo: r[2] || "",
        Issue: r[3] || "",
        Status: r[4] || "Pending",
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
        WorkBy: r[8] || "",
        Taskcompletedapproval: r[9] || "Pending",
      }));

    console.log(`Found ${tickets.length} created tickets`);
    res.json(tickets);
  } catch (err) {
    console.error("GET CREATED ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET ASSIGNED TICKETS ================= */
router.get("/assigned", auth, async (req, res) => {
  try {
    console.log("GET ASSIGNED - User:", req.user.name);
    
    const sheets = await getSheets();
    
    // Get user department
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:H",
    });
    const employees = empRes.data.values || [];
    
    // Find current user's department
    const currentUser = employees.find(e => e[1] === req.user.name);
    const userDept = currentUser ? currentUser[4] : "";
    console.log("User Department:", userDept);
    
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:Z`,
    });

    const rows = data.data.values || [];
    
    // Get all tickets assigned to this user
    let tickets = rows
      .filter((r) => r[2] === req.user.name)
      .map((r) => ({
        TicketID: r[0] || "",
        CreatedBy: r[1] || "",
        AssignedTo: r[2] || "",
        Issue: r[3] || "",
        Status: r[4] || "Pending",
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
        WorkBy: r[8] || "",
        Taskcompletedapproval: r[9] || "Pending",
      }));
    
    // For MIS users, apply special filtering
    if (userDept === "MIS") {
      tickets = tickets.filter(t => {
        if (t.Status === "Pending") return true;
        if (t.Status === "InProgress" || t.Status === "Done") {
          return t.WorkBy === req.user.name;
        }
        if (t.Status === "Approved") return true;
        return false;
      });
    }

    console.log(`Found ${tickets.length} assigned tickets`);
    res.json(tickets);
  } catch (err) {
    console.error("GET ASSIGNED ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= UPDATE STATUS ================= */
router.patch("/status/:ticketID", auth, async (req, res) => {
  try {
    console.log("UPDATE STATUS - User:", req.user.name);
    console.log("Ticket ID:", req.params.ticketID);
    console.log("New Status:", req.body.Status);

    const { Status } = req.body;
    if (!Status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const sheets = await getSheets();
    
    // Get user department
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Employee!A2:H",
    });
    const employees = empRes.data.values || [];
    
    const currentUser = employees.find(e => e[1] === req.user.name);
    const userDept = currentUser ? currentUser[4] : "";
    console.log("User Department:", userDept);
    
    // Get all tickets
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:Z`,
    });

    const rows = data.data.values || [];
    
    // Find the ticket
    let foundTicket = null;
    let ticketIndex = -1;
    
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === req.params.ticketID) {
        foundTicket = rows[i];
        ticketIndex = i;
        break;
      }
    }
    
    if (!foundTicket) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    console.log("Found Ticket:", {
      TicketID: foundTicket[0],
      Status: foundTicket[4],
      WorkBy: foundTicket[8],
      DoneDate: foundTicket[6],
      TaskApproval: foundTicket[9],
      CreatedBy: foundTicket[1],
      AssignedTo: foundTicket[2]
    });

    const ticketIssue = foundTicket[3];
    const currentStatus = foundTicket[4];
    const assignedTo = foundTicket[2];
    const createdBy = foundTicket[1];
    
    // FIXED: Permission logic - Allow if:
    // 1. User is assigned to the ticket (MIS doing their work)
    // 2. OR User created the ticket (Doer approving/rejecting)
    // 3. OR User is MIS and ticket is assigned to them


    
    // const canUpdate = (assignedTo === req.user.name) || (createdBy === req.user.name);
    
    // if (!canUpdate) {
    //   console.log("Permission denied:", {
    //     assignedTo,
    //     createdBy,
    //     userName: req.user.name
    //   });
    //   return res.status(403).json({ 
    //     error: "You don't have permission to update this ticket. Only the assigned MIS user or the creator can update it." 
    //   });
    // }
    
    // Find ALL tickets with same issue
    const matchingTickets = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][3] && rows[i][3].trim() === ticketIssue.trim()) {
        matchingTickets.push({ row: rows[i], index: i });
      }
    }

    console.log(`Found ${matchingTickets.length} matching tickets`);
    
    // Initialize update values
    let newStatus = Status;
    let doneDate = foundTicket[6];
    let workBy = foundTicket[8] || "";
    let taskApproval = foundTicket[9] || "Pending";
    
    // MIS User
    if (userDept === "MIS") {
      if (Status === "InProgress" && currentStatus === "Pending") {
        workBy = req.user.name;
        doneDate = "";
        taskApproval = "Pending";
        console.log("MIS Starting ticket");
      }
      else if (Status === "Done" && currentStatus === "InProgress") {
        if (workBy && workBy !== req.user.name) {
          return res.status(403).json({ error: "You can only complete tickets you started" });
        }
        doneDate = formatDateDDMMYYYYHHMMSS();
        taskApproval = "Pending";
        console.log("MIS Completing ticket");
      }
      else {
        return res.status(400).json({ 
          error: "MIS can only change Pending → InProgress or InProgress → Done" 
        });
      }
    }
    // Doer User (Creator)
    else {
      if (currentStatus !== "Done") {
        return res.status(400).json({ 
          error: "You can only approve or reject completed tickets" 
        });
      }
      
      if (Status === "Approved") {
        taskApproval = "Approved";
        newStatus = "Done"; // Keep status as Done but mark as approved
        console.log("Doer Approving ticket");
      }
      else if (Status === "Pending") {
        doneDate = "";
        // workBy = "";
        taskApproval = "Pending";
        newStatus = "Pending";
        console.log("Doer Rejecting ticket");
      }
      else {
        return res.status(400).json({ 
          error: "You can only change Done → Approved or Done → Pending" 
        });
      }
    }

    console.log("Final Values:", {
      Status: newStatus,
      DoneDate: doneDate,
      WorkBy: workBy,
      TaskApproval: taskApproval
    });

    // Update ALL matching tickets
    for (const ticket of matchingTickets) {
      const rowNum = ticket.index + 2; // +2 because header row + 0-based index
      const updatedRow = [...ticket.row];
      
      updatedRow[4] = newStatus;      // E: Status
      updatedRow[6] = doneDate;       // G: DoneDate
      updatedRow[8] = workBy;         // I: WorkBy
      updatedRow[9] = taskApproval;   // J: Taskcompletedapproval
      
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
        range: `${SHEET_NAME}!A${rowNum}:Z${rowNum}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [updatedRow] },
      });
    }

    res.json({ 
      ok: true, 
      message: `Updated ${matchingTickets.length} ticket(s) successfully`,
      newStatus,
      workBy,
      doneDate,
      taskApproval
    });

  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= GET ALL TICKETS WITH FILTERS ================= */
router.get("/all", auth, async (req, res) => {
  try {
    const { assignedTo, createdBy, status } = req.query;

    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:Z`,
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
        TicketID: r[0] || "",
        CreatedBy: r[1] || "",
        AssignedTo: r[2] || "",
        Issue: r[3] || "",
        Status: r[4] || "Pending",
        CreatedDate: r[5] || "",
        DoneDate: r[6] || "",
        IssuePhoto: r[7] || "",
        WorkBy: r[8] || "",
        Taskcompletedapproval: r[9] || "Pending",
      }));

    res.json({ ok: true, tickets });
  } catch (err) {
    console.error("GET ALL ERROR:", err);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

/* ================= FILTER TICKETS BY WEEK/MONTH ================= */
router.get("/filter", auth, async (req, res) => {
  try {
    const { month, week, selectedName } = req.query;
    if (!month || !week) {
      return res.status(400).json({ error: "Month and Week are required" });
    }

    const userName = req.user.name.trim().toLowerCase();

    const sheets = await getSheets();
    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_SUPPORTTICKET,
      range: `${SHEET_NAME}!A2:Z`,
    });

    const rows = sheetRes.data.values || [];

    function parseDDMMYYYY(str) {
      if (!str) return null;
      const p = str.split(" ")[0].split("/");
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
        if (day !== 0 && day !== 6) count++;
        cur.setDate(cur.getDate() + 1);
      }
      return count - 1;
    }

    const year = new Date().getFullYear();
    const selectedMonth = Number(month) - 1;

    function getWeekStartDate(weekNum, month, year) {
      const firstDay = new Date(year, month, 1);
      const dow = firstDay.getDay();
      const diff = dow === 0 ? 1 : 8 - dow;
      return new Date(year, month, 1 + diff + (weekNum - 2) * 7);
    }

    const weekStart = getWeekStartDate(Number(week), selectedMonth, year);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

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

        const shouldCount =
          createdDate <= weekEnd && (!doneDate || doneDate >= weekStart);

        if (!shouldCount) return;

        total++;

        if (doneDate && doneDate >= weekStart && doneDate <= weekEnd) {
          completed++;

          const wd = workingDaysBetween(createdDate, doneDate);
          if (wd > 3) delayed++;
        } else {
          pending++;
        }

        tickets.push({
          TicketID: r[0] || "",
          CreatedBy: r[1] || "",
          AssignedTo: r[2] || "",
          Issue: r[3] || "",
          Status: r[4] || "",
          CreatedDate: r[5] || "",
          DoneDate: r[6] || "",
          IssuePhoto: r[7] || "",
          WorkBy: r[8] || "",
          Taskcompletedapproval: r[9] || "",
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

    const nameToFilter = selectedName && selectedName.trim()
      ? selectedName.trim().toLowerCase()
      : userName;

    const assignedRows = rows.filter(
      (r) => r[2]?.trim().toLowerCase() === nameToFilter
    );

    const createdRows = rows.filter(
      (r) => r[1]?.trim().toLowerCase() === nameToFilter
    );

    const assignedData = calculateTickets(assignedRows);
    const createdData = calculateTickets(createdRows);

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
    console.error("FILTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;