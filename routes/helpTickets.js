const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");
const { parser } = require("../cloudinary");

const router = express.Router();
const SHEET_NAME = "HelpTicketsMaster";

// ======================================================
// DATE FORMATTER → dd/mm/yyyy hh:mm:ss
// ======================================================
function formatDateDDMMYYYYHHMMSS(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

/* ================= CREATE TICKET ================= */
router.post("/create", auth, parser.single("IssuePhoto"), async (req, res) => {
  try {
    const { AssignedTo, Issue } = req.body;
    if (!AssignedTo || !Issue) return res.status(400).json({ error: "AssignedTo and Issue required" });
    if (AssignedTo === req.user.name) return res.status(400).json({ error: "Cannot assign ticket to yourself" });

    const sheets = await getSheets();
    const ticketID = nanoid(6);
    const createdDate = formatDateDDMMYYYYHHMMSS();
    const status = "Pending";
    const photoUrl = req.file ? req.file.path : "";

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
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
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:H`
    });
    const rows = data.data.values || [];
    const tickets = rows.filter(r => r[1] === req.user.name).map(r => ({
      TicketID: r[0], CreatedBy: r[1], AssignedTo: r[2], Issue: r[3],
      Status: r[4], CreatedDate: r[5], DoneDate: r[6] || "", IssuePhoto: r[7] || ""
    }));
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================= GET ASSIGNED TICKETS ================= */
router.get("/assigned", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
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
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
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

/* ================= UPDATE STATUS ================= */
router.patch("/status/:ticketID", auth, async (req, res) => {
  try {
    const { Status } = req.body;
    if (!Status) return res.status(400).json({ error: "Status required" });

    const sheets = await getSheets();
    const data = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A2:H`
    });
    const rows = data.data.values || [];
    const index = rows.findIndex(r => r[0] === req.params.ticketID);
    if (index === -1) return res.status(404).json({ error: "Ticket not found" });

    const ticket = rows[index];
    ticket[4] = Status;
    ticket[6] = Status === "Done" ? formatDateDDMMYYYYHHMMSS() : "";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET_NAME}!A${index+2}:H${index+2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [ticket] }
    });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
