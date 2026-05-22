const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();
const SHEET_NAME = "WorkList";

const VALID_FREQUENCIES = ["Daily", "Weekly", "Monthly", "Yearly"];

async function readWorklistSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
  if (!spreadsheetId) {
    throw new Error("GOOGLE_SHEET_ID_WORKLIST is not configured in .env");
  }
  // Updated range to include new columns H and I (ScheduleDays, ScheduleDates)
  const range = `${SHEET_NAME}!A2:I`;

  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    return res.data.values || [];
  } catch (err) {
    if (err.message?.includes("permission") || err.code === 403) {
      throw new Error(`Service Account does not have access to WorkList sheet`);
    }
    throw err;
  }
}

function mapWorklist(r) {
  return {
    WorkListId: r[0] || "",
    EmployeeName: r[1] || "",
    WorklistName: r[2] || "",
    Frequency: r[3] || "",
    WorkingTime: r[4] || "",
    TemplateLink: r[5] || "",
    Remark: r[6] || "",
    ScheduleDays: r[7] || "",    // For Weekly: "Monday,Wednesday,Friday"
    ScheduleDates: r[8] || ""     // For Monthly/Yearly: "1,15,30" or "Jan 15"
  };
}

// DOER: GET MY WORKLISTS
router.get("/my", auth, async (req, res) => {
  try {
    const rows = await readWorklistSheet();
    const myName = req.user.name;
    const myWorklists = rows.filter((r) => r[1] === myName).map(mapWorklist);
    res.json({ ok: true, data: myWorklists, total: myWorklists.length });
  } catch (err) {
    console.error("Error in /my:", err);
    res.status(500).json({ error: err.message });
  }
});

// ADMIN: GET ALL WORKLISTS
router.get("/all", auth, async (req, res) => {
  try {
    const { employeeName, search } = req.query;
    const rows = await readWorklistSheet();

    let filtered = rows.map(mapWorklist);

    if (employeeName && employeeName !== "all") {
      filtered = filtered.filter((w) => w.EmployeeName === employeeName);
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (w) =>
          w.WorklistName.toLowerCase().includes(q) ||
          w.EmployeeName.toLowerCase().includes(q) ||
          w.WorkListId.toLowerCase().includes(q)
      );
    }

    res.json({ ok: true, data: filtered, total: filtered.length });
  } catch (err) {
    console.error("Error in /all:", err);
    res.status(500).json({ error: err.message });
  }
});

// CREATE WORKLIST
router.post("/", auth, async (req, res) => {
  try {
    const { 
      WorklistName, 
      Frequency, 
      WorkingTime, 
      EmployeeName, 
      TemplateLink, 
      Remark,
      ScheduleDays,      // NEW: For Weekly
      ScheduleDates      // NEW: For Monthly/Yearly
    } = req.body;
    
    const finalEmpName = EmployeeName || req.user.name;

    if (!WorklistName || !WorklistName.trim()) {
      return res.status(400).json({ error: "WorklistName is required" });
    }
    if (!Frequency || !VALID_FREQUENCIES.includes(Frequency)) {
      return res.status(400).json({ error: `Frequency must be one of: ${VALID_FREQUENCIES.join(", ")}` });
    }
    if (!WorkingTime || !WorkingTime.trim()) {
      return res.status(400).json({ error: "WorkingTime is required" });
    }
    
    // Validate based on frequency
    if (Frequency === "Weekly" && !ScheduleDays) {
      return res.status(400).json({ error: "Please select at least one day for Weekly frequency" });
    }
    if (Frequency === "Monthly" && !ScheduleDates) {
      return res.status(400).json({ error: "Please select at least one date for Monthly frequency" });
    }
    if (Frequency === "Yearly" && !ScheduleDates) {
      return res.status(400).json({ error: "Please select month and date for Yearly frequency" });
    }

    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
    const WorkListId = nanoid(8);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:I`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          WorkListId, 
          finalEmpName, 
          WorklistName.trim(), 
          Frequency, 
          WorkingTime.trim(),
          TemplateLink || "", 
          Remark || "",
          ScheduleDays || "",
          ScheduleDates || ""
        ]],
      },
    });

    res.json({ ok: true, WorkListId, message: "Worklist created successfully" });
  } catch (err) {
    console.error("Error in POST /:", err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE WORKLIST (DOER)
router.put("/:id", auth, async (req, res) => {
  try {
    const { 
      WorklistName, 
      Frequency, 
      WorkingTime, 
      TemplateLink, 
      Remark,
      ScheduleDays,
      ScheduleDates
    } = req.body;
    
    const rows = await readWorklistSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id);
    
    if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

    if (rows[idx][1] !== req.user.name) {
      return res.status(403).json({ error: "You can only update your own worklist" });
    }

    if (WorklistName) rows[idx][2] = WorklistName.trim();
    if (Frequency && VALID_FREQUENCIES.includes(Frequency)) rows[idx][3] = Frequency;
    if (WorkingTime) rows[idx][4] = WorkingTime.trim();
    if (TemplateLink !== undefined) rows[idx][5] = TemplateLink || "";
    if (Remark !== undefined) rows[idx][6] = Remark || "";
    if (ScheduleDays !== undefined) rows[idx][7] = ScheduleDays || "";
    if (ScheduleDates !== undefined) rows[idx][8] = ScheduleDates || "";

    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A${idx + 2}:I${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, message: "Worklist updated", worklist: mapWorklist(rows[idx]) });
  } catch (err) {
    console.error("Error in PUT /:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// ADMIN: UPDATE ANY WORKLIST
router.put("/admin/:id", auth, async (req, res) => {
  try {
    const { 
      WorklistName, 
      Frequency, 
      WorkingTime, 
      EmployeeName, 
      TemplateLink, 
      Remark,
      ScheduleDays,
      ScheduleDates
    } = req.body;
    
    const rows = await readWorklistSheet();
    const idx = rows.findIndex((r) => r[0] === req.params.id);
    
    if (idx === -1) return res.status(404).json({ error: "Worklist not found" });

    if (WorklistName) rows[idx][2] = WorklistName.trim();
    if (Frequency && VALID_FREQUENCIES.includes(Frequency)) rows[idx][3] = Frequency;
    if (WorkingTime) rows[idx][4] = WorkingTime.trim();
    if (EmployeeName) rows[idx][1] = EmployeeName.trim();
    if (TemplateLink !== undefined) rows[idx][5] = TemplateLink || "";
    if (Remark !== undefined) rows[idx][6] = Remark || "";
    if (ScheduleDays !== undefined) rows[idx][7] = ScheduleDays || "";
    if (ScheduleDates !== undefined) rows[idx][8] = ScheduleDates || "";

    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A${idx + 2}:I${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, message: "Worklist updated by admin", worklist: mapWorklist(rows[idx]) });
  } catch (err) {
    console.error("Error in PUT /admin/:id:", err);
    res.status(500).json({ error: err.message });
  }
});

// BULK UPLOAD
router.post("/bulk", auth, async (req, res) => {
  try {
    const { worklists } = req.body;
    if (!Array.isArray(worklists) || worklists.length === 0) {
      return res.status(400).json({ error: "worklists array is required" });
    }

    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_WORKLIST;
    const existingRows = await readWorklistSheet();

    const created = [];
    const skipped = [];
    const errors = [];

    for (let i = 0; i < worklists.length; i++) {
      const wl = worklists[i];
      const empName = wl.EmployeeName || req.user.name;

      if (!wl.WorklistName || !wl.WorklistName.trim()) {
        errors.push({ row: i + 1, errors: ["WorklistName is required"] });
        continue;
      }
      if (!wl.Frequency || !VALID_FREQUENCIES.includes(wl.Frequency)) {
        errors.push({ row: i + 1, errors: ["Frequency must be Daily, Weekly, Monthly, or Yearly"] });
        continue;
      }
      if (!wl.WorkingTime || !wl.WorkingTime.trim()) {
        errors.push({ row: i + 1, errors: ["WorkingTime is required"] });
        continue;
      }

      const isDuplicate = existingRows.some(
        (r) => r[1] === empName && r[2]?.toLowerCase() === wl.WorklistName?.trim().toLowerCase()
      );
      
      if (isDuplicate) {
        skipped.push({ row: i + 1, WorklistName: wl.WorklistName, reason: "Duplicate" });
        continue;
      }

      const WorkListId = nanoid(8);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A:I`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[
            WorkListId, 
            empName, 
            wl.WorklistName.trim(), 
            wl.Frequency, 
            wl.WorkingTime.trim(),
            wl.TemplateLink || "", 
            wl.Remark || "",
            wl.ScheduleDays || "",
            wl.ScheduleDates || ""
          ]],
        },
      });

      created.push({ row: i + 1, WorkListId, WorklistName: wl.WorklistName });
    }

    res.json({
      ok: true,
      summary: { total: worklists.length, created: created.length, skipped: skipped.length, errors: errors.length },
      created, skipped, errors,
    });
  } catch (err) {
    console.error("Error in POST /bulk:", err);
    res.status(500).json({ error: err.message });
  }
});

// DOWNLOAD
router.get("/download", auth, async (req, res) => {
  try {
    const { employeeName } = req.query;
    const rows = await readWorklistSheet();
    let data = rows.map(mapWorklist);
    if (employeeName && employeeName !== "all") {
      data = data.filter((w) => w.EmployeeName === employeeName);
    }
    res.json({ ok: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DOER DOWNLOAD MY WORKLISTS
router.get("/download/my", auth, async (req, res) => {
  try {
    const rows = await readWorklistSheet();
    const data = rows.filter((r) => r[1] === req.user.name).map(mapWorklist);
    res.json({ ok: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;