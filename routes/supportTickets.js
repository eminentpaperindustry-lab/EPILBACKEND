const express = require("express");
const { getSheets } = require("../googleSheetsClient");
const { nanoid } = require("nanoid");

const router = express.Router();
const SHEET = "SupportTickets";

// Read rows function
async function readRows() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${SHEET}!A2:F`,
  });
  return res.data.values || [];
}

// GET all support tickets
router.get("/", async (req, res) => {
  try {
    const rows = await readRows();

    const data = rows.map(r => ({
      TicketID: r[0],
      EmployeeName: r[1],
      Issue: r[2],
      CreatedDate: r[3],
      Status: r[4],
      ResolvedDate: r[5]
    }));

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CREATE support ticket
router.post("/", async (req, res) => {
  try {
    const { EmployeeName, Issue } = req.body;

    const TicketID = nanoid(8);
    const CreatedDate = new Date().toISOString();
    const Status = "Open";

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET}!A:F`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [TicketID, EmployeeName, Issue, CreatedDate, Status, ""]
        ]
      }
    });

    res.json({ ok: true, TicketID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// UPDATE ticket status
router.patch("/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const id = req.params.id;

    const rows = await readRows();
    const index = rows.findIndex(r => r[0] === id);

    if (index === -1)
      return res.status(404).json({ error: "Ticket not found" });

    const rowNumber = index + 2;
    const row = rows[index];

    row[4] = status;

    if (status === "Resolved") {
      row[5] = new Date().toISOString();
    }

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${SHEET}!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [row] }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
