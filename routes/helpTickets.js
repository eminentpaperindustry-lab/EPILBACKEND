const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

// CREATE TICKET
router.post("/create", auth, async (req, res) => {
  try {
    const { AssignedTo, Issue } = req.body;
    if (!AssignedTo || !Issue)
      return res.status(400).json({ error: "Required fields missing" });

    const sheets = await getSheets();
    const ticketID = nanoid(6);
    const createdDate = new Date().toISOString();
    const status = "Open";
    const createdBy = req.user.name;

    // AssignedTo sheet
    const assignedSheet = `${AssignedTo}_HelpTickets`;
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${assignedSheet}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[ticketID, Issue, createdBy, AssignedTo, createdDate, "", status, ""]],
      },
    });

    // Creator sheet
    const creatorSheet = `${createdBy}_HelpTickets`;
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${creatorSheet}!A:H`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[ticketID, Issue, createdBy, AssignedTo, createdDate, "", status, ""]],
      },
    });

    res.json({ ok: true, ticketID });
  } catch (err) {
    console.error("CREATE TICKET ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET ASSIGNED TICKETS
router.get("/assigned", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const sheetName = `${req.user.name}_HelpTickets`;
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A2:H`,
    });
    const rows = data.data.values || [];
    const tickets = rows.map((r) => ({
      TicketID: r[0],
      Issue: r[1],
      CreatedBy: r[2],
      AssignedTo: r[3],
      CreatedDate: r[4],
      DoneDate: r[5],
      Status: r[6],
      Notes: r[7],
    }));
    res.json(tickets);
  } catch (err) {
    console.error("GET ASSIGNED TICKETS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET CREATED TICKETS
router.get("/created", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const sheetName = `${req.user.name}_HelpTickets`;
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A2:H`,
    });
    const rows = data.data.values || [];
    const tickets = rows.map((r) => ({
      TicketID: r[0],
      Issue: r[1],
      CreatedBy: r[2],
      AssignedTo: r[3],
      CreatedDate: r[4],
      DoneDate: r[5],
      Status: r[6],
      Notes: r[7],
    }));
    res.json(tickets);
  } catch (err) {
    console.error("GET CREATED TICKETS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE TICKET STATUS (SYNC BOTH SHEETS)
router.patch("/status/:ticketID", auth, async (req, res) => {
  try {
    const { Status } = req.body;
    const { ticketID } = req.params;

    const sheets = await getSheets();
    const userSheetName = `${req.user.name}_HelpTickets`;

    // Fetch both sheets (creator + assigned)
    const userTickets = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${userSheetName}!A2:H`,
    });
    const rows = userTickets.data.values || [];
    const idx = rows.findIndex((r) => r[0] === ticketID);
    if (idx === -1) return res.status(404).json({ error: "Ticket not found" });

    const ticket = rows[idx];

    // Determine permission
    const creatorName = ticket[2];
    const assignedName = ticket[3];

    // Only Assigned can update Open -> InProgress
    // Only Creator can mark Done if status is InProgress
    if (
      (req.user.name === assignedName &&
        (ticket[6] === "Open" || ticket[6] === "InProgress") &&
        (Status === "Open" || Status === "InProgress")) ||
      (req.user.name === creatorName &&
        ticket[6] === "InProgress" &&
        Status === "Done")
    ) {
      // Update both sheets
      const sheetsToUpdate = [creatorName, assignedName];
      for (const name of sheetsToUpdate) {
        const sheetData = await sheets.spreadsheets.values.get({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `${name}_HelpTickets!A2:H`,
        });
        const sheetRows = sheetData.data.values || [];
        const i = sheetRows.findIndex((r) => r[0] === ticketID);
        if (i !== -1) {
          sheetRows[i][6] = Status;
          if (Status === "Done") sheetRows[i][5] = new Date().toISOString();
          await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${name}_HelpTickets!A${i + 2}:H${i + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [sheetRows[i]] },
          });
        }
      }
      return res.json({ ok: true });
    } else {
      return res.status(403).json({ error: "Not authorized to update status" });
    }
  } catch (err) {
    console.error("UPDATE TICKET STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
