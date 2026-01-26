const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();

const MASTER_SHEET = "Master"; // SINGLE DATA SOURCE

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

// ======================================================
// FREQUENCY DEADLINE GENERATOR (D/W/M)
// ======================================================
function getNextDeadline(freq) {
  const date = new Date();

  if (freq === "D") {
    date.setDate(date.getDate() + 1);
  } else if (freq === "W") {
    date.setDate(date.getDate() + 7);
  } else if (freq === "M") {
    date.setMonth(date.getMonth() + 1);
  }

  return date.toISOString().split("T")[0];
}



// ======================================================
// GET USER-SPECIFIC CHECKLIST ITEMS (FILTER BY NAME)
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    // Fetch all master checklist data
    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A2:K`, // A to K → 11 columns (0–10)
    });

    const rows = fetchRes.data.values || [];

    const userName = req.user.name;

    // FILTER ROWS BY USER NAME
    const userRows = rows.filter((r) =>  r[0] === userName && (!r[7] || r[7].trim() === ""));

    const data = userRows.map((r) => ({
      Name: r[0],
      Email: r[1],
      Department: r[2],
      TaskID: r[3],
      Freq: r[4],
      Task: r[5],
      Planned: r[6], // deadline
      Actual: r[7], // done date
    }));

    res.json(data);
  } catch (err) {
    console.error("Checklist GET Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SEARCH CHECKLIST BY EMPLOYEE NAME (FULLY CORRECTED)
// ======================================================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;

    // Ensure 'name' query is valid
    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Name is required" });
    }
    const sheets = await getSheets();
    // Fetch data from Google Sheets
    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A2:K`, // A to K → 11 columns (0–10)
    });

    const rows = fetchRes.data.values || [];

    // If 'name' is "all", return all data (no filtering by name)
    if (name.toLowerCase() === "all") {
      const allData = rows.map((r) => ({
        Name: r[0],
        Email: r[1],
        Department: r[2],
        TaskID: r[3],
        Freq: r[4],
        Task: r[5],
        Planned: r[6],
        Actual: r[7],
        EmailForBuddy: r[8],
        BuddyEmail: r[9],
        Archive: r[10],
      }));
      return res.json(allData);
    }

    // FILTER BY EXACT NAME (Case-insensitive)
    const filtered = rows
      .filter((r) => r[0]?.toLowerCase() === name.toLowerCase()) // Filter by name
      .map((r) => ({
        Name: r[0],
        Email: r[1],
        Department: r[2],
        TaskID: r[3],
        Freq: r[4],
        Task: r[5],
        Planned: r[6],
        Actual: r[7],
        EmailForBuddy: r[8],
        BuddyEmail: r[9],
        Archive: r[10],
      }));

    res.json(filtered);
  } catch (err) {
    console.error("Checklist Search Error:", err);
    res.status(500).json({ error: err.message });
  }
});





// ======================================================
// CREATE A NEW TASK FOR USER (INSERT INTO MASTER SHEET)
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { Task, Freq } = req.body;

    if (!Task || !Freq) {
      return res.status(400).json({ error: "Task and Freq are required" });
    }

    const sheets = await getSheets();
    const TaskID = nanoid(6);
    const PlannedDate = getNextDeadline(Freq);

    const values = [
      [
        req.user.name,        // Name
        req.user.email || "", // Email
        req.user.department || "", // Department
        TaskID,
        Freq,
        Task,
        PlannedDate, // Planned
        "",          // Actual
        req.user.name, // Email for buddy (optional)
        `${new Date().toLocaleString("default", { month: "short" })}-${new Date().getFullYear().toString().slice(-2)}`, // Buddy Month
        "" // ARCHIVE
      ],
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A:K`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });

    res.json({ ok: true, TaskID, Planned: PlannedDate });
  } catch (err) {
    console.error("Checklist CREATE Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// MARK TASK AS DONE (UPDATE ACTUAL DATE)
// ======================================================
// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const sheets = await getSheets();

//     const fetchRes = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `${MASTER_SHEET}!A2:K`,
//     });

//     const rows = fetchRes.data.values || [];

//     // Find row by Task ID
//     const idx = rows.findIndex((r) => r[3] === req.params.id);

//     if (idx === -1) {
//       return res.status(404).json({ error: "Task not found" });
//     }

//     const row = rows[idx];
//     row[7] = formatDateDDMMYYYYHHMMSS(new Date()); // Actual = done (formatted date)

//     await sheets.spreadsheets.values.update({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: [row] },
//     });

//     res.json({ ok: true, Actual: row[7] });
//   } catch (err) {
//     console.error("Checklist DONE Error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });


// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const sheets = await getSheets();

//     const fetchRes = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `${MASTER_SHEET}!A2:K`,
//     });

//     const rows = fetchRes.data.values || [];

//     // Find row by Task ID
//     const idx = rows.findIndex((r) => r[3] === req.params.id);

//     if (idx === -1) {
//       return res.status(404).json({ error: "Task not found" });
//     }

//     const row = rows[idx];
//     row[7] = formatDateDDMMYYYYHHMMSS(new Date()); // Actual = done (formatted date)

//     await sheets.spreadsheets.values.update({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: [row] },
//     });

//     res.json({ ok: true, Actual: row[7] });
//   } catch (err) {
//     console.error("Checklist DONE Error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });


// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const sheets = await getSheets();

//     // Master sheet se sirf check karna ki ID hai ya nahi
//     // const masterRes = await sheets.spreadsheets.values.get({
//     //   spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//     //   range: `Master!D2:D`,
//     // });
//     // const masterIDs = masterRes.data.values || [];

//     // const idExists = masterIDs.some(row => row[0] === req.params.id);
//     // if (!idExists) {
//     //   return res.status(404).json({ error: "Task ID not found in master sheet" });
//     // }

//     // Date format function
//     function formatDateDDMMYYYYHHMMSS(date) {
//       const pad = (n) => n.toString().padStart(2, "0");
//       const day = pad(date.getDate());
//       const month = pad(date.getMonth() + 1);
//       const year = date.getFullYear();
//       const hours = pad(date.getHours());
//       const minutes = pad(date.getMinutes());
//       const seconds = pad(date.getSeconds());
//       return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
//     }

//     const currentDate = formatDateDDMMYYYYHHMMSS(new Date());

//     // Consolidated sheet me check karo existing rows
//     const consolidatedRes = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `Consolidated!A2:B`,
//     });

//     const consolidatedRows = consolidatedRes.data.values || [];
//     const rowIndex = consolidatedRows.findIndex(row => row[0] === req.params.id);

//     if (rowIndex === -1) {
//       // Append new row
//       await sheets.spreadsheets.values.append({
//         spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//         range: `Consolidated!A:B`,
//         valueInputOption: "USER_ENTERED",
//         requestBody: {
//           values: [[req.params.id, currentDate]],
//         },
//       });
//     } else {
//       // Update existing row
//       const sheetRow = rowIndex + 2;
//       await sheets.spreadsheets.values.update({
//         spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//         range: `Consolidated!A${sheetRow}:B${sheetRow}`,
//         valueInputOption: "USER_ENTERED",
//         requestBody: {
//           values: [[req.params.id, currentDate]],
//         },
//       });
//     }

//     res.json({ ok: true, TaskID: req.params.id, DoneAt: currentDate });
//   } catch (err) {
//     console.error("Error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

router.patch("/done/:id", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID_CHECKLIST;

    // Date format function
    function formatDateDDMMYYYYHHMMSS(date) {
      const pad = (n) => n.toString().padStart(2, "0");
      const day = pad(date.getDate());
      const month = pad(date.getMonth() + 1);
      const year = date.getFullYear();
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
    }

    const currentDate = formatDateDDMMYYYYHHMMSS(new Date());

    // 1️⃣ Fetch existing rows in Consolidated sheet
    const consolidatedRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Consolidated!A2:B`,
    });

    const consolidatedRows = consolidatedRes.data.values || [];
    const rowIndex = consolidatedRows.findIndex(row => row[0] === req.params.id);

    // 2️⃣ Retry function for writing (append or update)
    const writeWithRetry = async (values, range, retry = 3) => {
      try {
        if (rowIndex === -1) {
          // Append new row
          await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [values] },
          });
        } else {
          // Update existing row
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [values] },
          });
        }
      } catch (err) {
        if (retry === 0) throw err;
        await new Promise(r => setTimeout(r, 1000));
        return writeWithRetry(values, range, retry - 1);
      }
    };

    // 3️⃣ Determine range
    const range = rowIndex === -1 ? `Consolidated!A:B` : `Consolidated!A${rowIndex + 2}:B${rowIndex + 2}`;

    // 4️⃣ Write to sheet
    await writeWithRetry([req.params.id, currentDate], range);

    // ✅ Success response only after sheet update
    res.json({ ok: true, TaskID: req.params.id, DoneAt: currentDate });

  } catch (err) {
    console.error("GOOGLE SHEET ERROR:", err);
    res.status(500).json({ error: "Task not updated in Consolidated sheet" });
  }
});


router.get("/filter", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];
    const { month, week, startDate, endDate } = req.query;
    const userName = req.user.name.trim().toLowerCase();

    // Parse dd/mm/yyyy (ignore time)
    function parseDDMMYYYY(str) {
      if (!str) return null;
      const parts = str.split(" ")[0].split("/");
      if (parts.length !== 3) return null;
      const [d, m, y] = parts;
      const year = y.length === 2 ? 2000 + +y : +y;
      return new Date(year, +m - 1, +d);
    }

    // Days in month helper
    function daysInMonth(year, month) {
      return new Date(year, month, 0).getDate();
    }

    // Check if date is in month/week
    function isInMonthWeek(date, monthNum, weekNum) {
      if (!date) return false;
      if (date.getMonth() + 1 !== +monthNum) return false;
      const day = date.getDate();
      const lastDay = daysInMonth(date.getFullYear(), monthNum);
      const startDay = (weekNum - 1) * 7 + 1;
      let endDay = weekNum * 7;
      if (endDay > lastDay) endDay = lastDay;
      return day >= startDay && day <= endDay;
    }

    const filteredRows = rows.filter((r) => {
      const rowName = (r[0] || "").trim().toLowerCase();
      const planned = parseDDMMYYYY(r[6]);
      const actual = parseDDMMYYYY(r[7]);

      // 1️⃣ User filter
      if (rowName !== userName) return false;

      // 2️⃣ Month/week filter
      if (month && week) {
        const m = parseInt(month);
        const w = parseInt(week);
        const inWeek = (planned && isInMonthWeek(planned, m, w)) || (actual && isInMonthWeek(actual, m, w));
        if (!inWeek) return false;
      }

      // 3️⃣ Date range filter
      if (startDate || endDate) {
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        const datesToCheck = [planned, actual].filter(Boolean);
        if (datesToCheck.length === 0) return false;
        const inRange = datesToCheck.some(d => {
          if (start && d < start) return false;
          if (end && d > end) return false;
          return true;
        });
        if (!inRange) return false;
      }

      return true;
    });

    const totalTasks = filteredRows.length;
    const completedTasks = filteredRows.filter(r => r[7] && r[7].trim() !== "").length;
    const pendingTasks = totalTasks - completedTasks;
    const delayedTasks = filteredRows.filter(r => {
      const planned = parseDDMMYYYY(r[6]);
      const actual = parseDDMMYYYY(r[7]);
      return actual && planned && actual > planned;
    }).length;

    const pendingPercentage = totalTasks ? ((pendingTasks / totalTasks) * 100).toFixed(2) : "0.00";
    const delayedPercentage = totalTasks ? ((delayedTasks / totalTasks) * 100).toFixed(2) : "0.00";

    res.json({
      tasks: filteredRows.map(r => ({
        Name: r[0],
        Email: r[1],
        Department: r[2],
        TaskID: r[3],
        Freq: r[4],
        Task: r[5],
        Planned: r[6],
        Actual: r[7],
      })),
      totalTasks,
      completedTasks,
      pendingTasks,
      delayedTasks,
      pendingPercentage,
      delayedPercentage,
    });

  } catch (err) {
    console.error("Checklist Filter Error:", err);
    res.status(500).json({ error: err.message });
  }
});


router.get("/test", (req, res) => {
  res.json({ ok: true, msg: "Route works!" });
});


// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const sheets = await getSheets();
//     const sheetName = "Consolidated";

//     const doneTimestamp = formatDateDDMMYYYYHHMMSS(new Date());

//     // Console me id aur date/time print karo
//     console.log(`ID: ${req.params.id}, Done Time: ${doneTimestamp}`);

//     // Ye data sheet me add karna hai — id in col A, done date in col B (example)
//     // Agar aur columns bhi hain, to adjust karo accordingly

//     const newRow = [req.params.id, doneTimestamp];

//     // Append new row at the bottom of the sheet
//     await sheets.spreadsheets.values.append({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
//       range: `${sheetName}!A:B`,  // Adjust range according to columns used
//       valueInputOption: "USER_ENTERED",
//       insertDataOption: "INSERT_ROWS",
//       requestBody: { values: [newRow] },
//     });

//     res.json({ ok: true, id: req.params.id, doneTime: doneTimestamp });
//   } catch (err) {
//     console.error("Checklist DONE Error:", err);
//     res.status(500).json({ error: err.message });
//   }
// });


// ======================================================
// DELETE TASK
// ======================================================
router.delete("/:id", auth, async (req, res) => {
  try {
    const sheets = await getSheets();

    const fetchRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A2:K`,
    });

    const rows = fetchRes.data.values || [];
    const idx = rows.findIndex((r) => r[3] === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    await sheets.spreadsheets.values.clear({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_CHECKLIST,
      range: `${MASTER_SHEET}!A${idx + 2}:K${idx + 2}`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Checklist DELETE Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
