const express = require("express");
const { nanoid } = require("nanoid");
const { getSheets } = require("../googleSheetsClient");
const auth = require("../middleware/auth");

const router = express.Router();
const SHEET_NAME = "DelegationMaster";

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

// Helper function to safely access a cell in the sheet
const getCellValue = (row, index, defaultValue = "") => {
  return row[index] || defaultValue;
};

// ======================================================
// GET TASKS FOR LOGGED-IN USER
// ======================================================
router.get("/", auth, async (req, res) => {
  try {
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const tasks = rows
      .filter((r) => r[1] === req.user.name)
      .map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: parseInt(r[8]) || 0,
        Priority: r[9],
        Status: r[10] || "Pending",
        Followup: r[11] || "",
        Taskcompletedapproval: r[13] || "Pending",
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// CREATE NEW TASK
// ======================================================
router.post("/", auth, async (req, res) => {
  try {
    const { TaskName, Deadline, Priority, Notes, Name } = req.body;
    const TaskID = nanoid(6);
    const CreatedDate = formatDateDDMMYYYYHHMMSS();

    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          TaskID,
          Name ?? req.user.name,
          TaskName,
          CreatedDate,
          Deadline,
          "",
          "",
          "",
          0,
          Priority,
          "Pending",
          Notes,
          "",
          "Pending",
        ]],
      },
    });

    res.json({ ok: true, TaskID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//========================================================
// filter task details

// Helper function to parse dates in 'dd/mm/yyyy' or 'dd/mm/yyyy hh:mm:ss' format
const parseDate = (dateString) => {
  if (!dateString) return null;

  const parts = dateString.split(" ");
  const dateParts = parts[0].split("/"); // Split dd/mm/yyyy
  const timeParts = parts[1] ? parts[1].split(":") : [0, 0, 0]; // If time is available, split hh:mm:ss

  // Ensure valid date format
  if (dateParts.length !== 3) return null;

  const day = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10) - 1; // Months are 0-indexed
  const year = parseInt(dateParts[2], 10);
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = parseInt(timeParts[2], 10);

  // Create and return the Date object
  const parsedDate = new Date(year, month, day, hours, minutes, seconds);
  return isNaN(parsedDate) ? null : parsedDate;
};


// Function to get the start date of a week given the week number and the selected month
// function getWeekStartDate(weekNumber, year, month) {
//   // First day of the selected month (month is 0-indexed)
//   const firstDayOfMonth = new Date(year, month, 1);
  
//   // Get the day of the week for the 1st of the selected month
//   const dayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

//   // Calculate the start of the selected week
//   const diff = (weekNumber - 1) * 7 - dayOfWeek + 1; // Calculate the first day of the selected week
//   const weekStart = new Date(firstDayOfMonth);
//   weekStart.setDate(firstDayOfMonth.getDate() + diff);

//   return weekStart;
// }

// // Helper function to calculate the end date of the week
// function getWeekEndDate(weekStart) {
//   const weekEnd = new Date(weekStart);
//   weekEnd.setDate(weekStart.getDate() + 6); // Week end is 6 days after the week start

//   return weekEnd;
// }

// // Helper function to parse date correctly
// // Helper function to parse date correctly from the format DD/MM/YYYY HH:MM:SS
// function parseDate(dateString) {
//   // Checking if the input is valid date
//   if (!dateString) return null; // If no date provided, return null

//   const parts = dateString.split(/[- :/]/); // Split date by space, dash, colon, and slash
//   // Ensure valid date parts and handle parsing accordingly
//   if (parts.length >= 6) {
//     // Creating a new Date object from day, month, year, hour, minute, second
//     return new Date(parts[2], parts[1] - 1, parts[0], parts[3] || 0, parts[4] || 0, parts[5] || 0);
//   }
//   return null; // Return null if the date string does not match expected format
// }

// // Example test case:
// console.log(parseDate("26/12/2025 11:33:37")); // Should return valid date


// // API Endpoint to get filtered tasks based on the month and week
// // API Endpoint to get filtered tasks based on the month and week
// router.get("/filter", auth, async (req, res) => {
//   try {
//     const { month, week } = req.query;

//     // Validate input
//     if (!month || !week) {
//       return res.status(400).json({ error: "Month and Week are required" });
//     }

//     // Fetch task data from Google Sheets
//     const sheets = await getSheets();
//     const fetch = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
//       range: `${SHEET_NAME}!A2:R`,
//     });

//     const rows = fetch.data.values || [];
//     let filteredTasks = rows.filter((r) => r[1] === req.user.name); // Filter tasks by user

//     // Convert month to match format (e.g. 01-Jan-2024 -> 01)
//     const monthRegex = new RegExp(`^${month}-`, "i");

//     // Filter tasks by month (created date or deadline date)
//     filteredTasks = filteredTasks.filter((task) => {
//       const createdDate = parseDate(task[3]); // Parse the created date
//       const deadlineDate = parseDate(task[4]); // Parse the deadline date
// console.log("createdDate:", createdDate);

//       // Check if parsed dates are valid
//       if (!createdDate || !deadlineDate) return false; // If invalid date, skip this task

//       // Filter by month (created date and deadline date)
//       const matchesMonth = monthRegex.test(createdDate.toISOString().slice(0, 7)) || monthRegex.test(deadlineDate.toISOString().slice(0, 7));
//       return matchesMonth;
//     });

//     // Now, calculate the week start and end dates based on selected month and week
//     const weekStart = getWeekStartDate(week, 2025, month - 1); // Subtract 1 from month because month is 0-indexed
//     const weekEnd = getWeekEndDate(weekStart); // Calculate the week end date

//     console.log(`Selected Month: ${month}, Week: ${week}`);
//     console.log(`Week Start: ${weekStart.toISOString()}`);
//     console.log(`Week End: ${weekEnd.toISOString()}`);

//     // Filter tasks that fall within the selected week
//     filteredTasks = filteredTasks.filter((task) => {
//       const createdDate = parseDate(task[3]); // Parse the created date
//       return createdDate >= weekStart && createdDate <= weekEnd;
//     });

//     // Calculate counts for the tasks
//     let totalWork = filteredTasks.length;
//     let workDone = 0;
//     let workDoneOnTime = 0;
//     let workNotDoneOnTime = 0;
//     let pendingTasks = 0;
//     let completedButNotOnTime = 0;

//     filteredTasks.forEach((task) => {
//       const completedDate = task[7] ? parseDate(task[7]) : null; // Parse the completed date
//       const deadlineDate = parseDate(task[4]); // Parse the deadline date

//       // Pending tasks handling
//       if (!completedDate) {
//         pendingTasks++; // If task is not completed, it's pending
//       } else {
//         // Task completed during this week or month
//         if (completedDate >= weekStart && completedDate <= weekEnd) {
//           workDone++;

//           if (completedDate <= deadlineDate) {
//             workDoneOnTime++;
//           } else {
//             workNotDoneOnTime++;
//             completedButNotOnTime++;
//           }
//         }
//       }
//     });

//     let result = {
//       totalWork,
//       workDone,
//       workDoneOnTime,
//       workNotDoneOnTime,
//       pendingTasks,
//       completedButNotOnTime,
//       tasks: filteredTasks.map((r) => ({
//         TaskID: r[0],
//         Name: r[1],
//         TaskName: r[2],
//         CreatedDate: r[3],
//         Deadline: r[4],
//         Revision1: r[5],
//         Revision2: r[6],
//         FinalDate: r[7],
//         Revisions: parseInt(r[8]) || 0,
//         Priority: r[9],
//         Status: r[10] || "Pending",
//         Followup: r[11] || "",
//         Taskcompletedapproval: r[13] || "Pending",
//       })),
//     };

//     res.json(result);
//   } catch (err) {
//     console.error("Error:", err); // Add error logging for better debugging
//     res.status(500).json({ error: err.message });
//   }
// });

// Helper function to parse the date correctly for "DD/MM/YYYY HH:MM:SS"
// function parseDate(dateString) {
//   if (!dateString) return null;
//   const parts = dateString.split(/[- :/]/);  // Split based on common delimiters
//   if (parts.length >= 6) {
//     return new Date(parts[2], parts[1] - 1, parts[0], parts[3] || 0, parts[4] || 0, parts[5] || 0);
//   }
//   return null; // If the date string doesn't match expected format
// }

// Helper function to get the start date of the selected week
function getWeekStartDate(weekNumber, year, month) {
  const date = new Date(year, month, 1); // Set to the 1st of the month
  const dayOfWeek = date.getDay(); // Day of the week for 1st of the month
  const diff = (weekNumber - 1) * 7 - dayOfWeek + 1; // Adjust to get the start date of the week
  date.setDate(date.getDate() + diff);
  return date;
}

// Helper function to get the end date of the selected week
function getWeekEndDate(weekStartDate) {
  const endDate = new Date(weekStartDate);
  endDate.setDate(weekStartDate.getDate() + 6); // Add 6 days to get the week's end date
  return endDate;
}

// API Endpoint to get filtered tasks based on the month and week
router.get("/filter", auth, async (req, res) => {
  try {
    const { month, week } = req.query;

    if (!month || !week) {
      return res.status(400).json({ error: "Month and Week are required" });
    }

    // Fetch task data from Google Sheets
    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    let filteredTasks = rows.filter((r) => r[1] === req.user.name); // Filter tasks by user

    // Parse the month to match the expected format (e.g., '12' for December)
    const monthRegex = new RegExp(`^${month}-`, "i");

    // Filter tasks by month (created date or deadline date)
    filteredTasks = filteredTasks.filter((task) => {
      const createdDate = parseDate(task[3]); // Parse the created date
      const deadlineDate = parseDate(task[4]); // Parse the deadline date

      // If dates are invalid, skip the task
      if (!createdDate || !deadlineDate) return false;

      // Filter by month (created date and deadline date)
      const matchesMonth = monthRegex.test(createdDate.toISOString().slice(0, 7)) || monthRegex.test(deadlineDate.toISOString().slice(0, 7));
      return matchesMonth;
    });

    // Get the start and end dates of the selected week (in the selected month)
    const weekStart = getWeekStartDate(week, 2025, month - 1); // Get the start of the selected week (month is zero-indexed)
    const weekEnd = getWeekEndDate(weekStart); // Get the end of the selected week

    console.log(`Selected Month: ${month}, Week: ${week}`);
    console.log(`Week Start: ${weekStart.toISOString()}`);
    console.log(`Week End: ${weekEnd.toISOString()}`);

    console.log("filteredTasks: ", filteredTasks);
    

    // Filter tasks by week (tasks created within the selected week)
    filteredTasks = filteredTasks.filter((task) => {
      const createdDate = parseDate(task[3]);
      
      console.log("parseDate(task[3]): ", parseDate(task[3]));
      
      
      // Parse the created date
      return createdDate >= weekStart && createdDate <= weekEnd;
    });
console.log("createdDate: ",filteredTasks);
    // Calculate counts for tasks
    let totalWork = filteredTasks.length;
    let workDone = 0;
    let workDoneOnTime = 0;
    let workNotDoneOnTime = 0;
    let pendingTasks = 0;
    let completedButNotOnTime = 0;

    filteredTasks.forEach((task) => {
      const completedDate = task[7] ? parseDate(task[7]) : null; // Parse the completed date
      const deadlineDate = parseDate(task[4]); // Parse the deadline date

      // Pending tasks handling
      if (!completedDate) {
        pendingTasks++; // Task is pending if no completed date
      } else {
        // Task completed within this week or month
        if (completedDate >= weekStart && completedDate <= weekEnd) {
          workDone++;

          if (completedDate <= deadlineDate) {
            workDoneOnTime++;
          } else {
            workNotDoneOnTime++;
            completedButNotOnTime++;
          }
        }
      }
    });

    // Return the filtered tasks and count data
    let result = {
      totalWork,
      workDone,
      workDoneOnTime,
      workNotDoneOnTime,
      pendingTasks,
      completedButNotOnTime,
      tasks: filteredTasks.map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: parseInt(r[8]) || 0,
        Priority: r[9],
        Status: r[10] || "Pending",
        Followup: r[11] || "",
        Taskcompletedapproval: r[13] || "Pending",
      })),
    };

    res.json(result);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message });
  }
});




//=========================================================

// ======================================================
// UPDATE TASK DETAILS
// ======================================================
router.put("/update/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { TaskName, Deadline, Priority, Notes, Status } = req.body;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows[idx][2] = TaskName || rows[idx][2];
    rows[idx][4] = Deadline || rows[idx][4];
    rows[idx][9] = Priority || rows[idx][9];
    rows[idx][10] = Status || rows[idx][10];
    rows[idx][11] = Notes || rows[idx][11];

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updatedTask: rows[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// DELETE TASK
// ======================================================
router.delete("/delete/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    rows.splice(idx, 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    res.json({ ok: true, message: "Task deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// MARK TASK DONE
// ======================================================
// router.patch("/done/:id", auth, async (req, res) => {
//   try {
//     const taskId = req.params.id;
//     const sheets = await getSheets();
//     const fetch = await sheets.spreadsheets.values.get({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
//       range: `${SHEET_NAME}!A2:R`,
//     });

//     const rows = fetch.data.values || [];
//     const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
//     if (idx === -1) return res.status(404).json({ error: "Task not found" });

//     rows[idx][7] = formatDateDDMMYYYYHHMMSS(); // IST final date
//     rows[idx][10] = "Completed";

//     await sheets.spreadsheets.values.update({
//       spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
//       range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
//       valueInputOption: "USER_ENTERED",
//       requestBody: { values: [rows[idx]] },
//     });

//     res.json({ ok: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

router.patch("/done/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const sheets = await getSheets();

    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex(
      (r) => r[0] === taskId && r[1] === req.user.name
    );

    if (idx === -1)
      return res.status(404).json({ error: "Task not found" });

    // 🔹 Completion date (NOW)
    const completedDate = new Date();

    // 🔹 Week ka Monday nikalna
    const day = completedDate.getDay(); // 0=Sunday
    const diff = completedDate.getDate() - day + (day === 0 ? -6 : 1);
    const mondayDate = new Date(completedDate);
    mondayDate.setDate(diff);

    const pad = (n) => String(n).padStart(2, "0");

    const format = (d) =>
      `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    // ✅ index 7 → completed date
    rows[idx][7] = format(completedDate);

    // ✅ index 12 → us week ka Monday
    rows[idx][12] = format(mondayDate);

    rows[idx][10] = "Completed";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ======================================================
// SHIFT TASK (Revision1 / Revision2)
// ======================================================
router.patch("/shift/:id", auth, async (req, res) => {
  try {
    const { newDeadline, revisionField } = req.body;
    const taskId = req.params.id;

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId && r[1] === req.user.name);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });
console.log("newDeadline: ", newDeadline);

    rows[idx][4] = newDeadline;
    rows[idx][8] = (parseInt(rows[idx][8]) || 0) + 1;
    rows[idx][10] = "Shifted";

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SEARCH BY NAME
// ======================================================
router.get("/search/by-name", auth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    if (name.toLowerCase() === "all") {
      return res.json(rows.map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: r[8],
        Priority: r[9],
        Status: r[10],
        Followup: r[11],
        Taskcompletedapproval: r[13] || "Pending",
      })));
    }

    const tasks = rows
      .filter((r) => r[1]?.toLowerCase() === name.toLowerCase())
      .map((r) => ({
        TaskID: r[0],
        Name: r[1],
        TaskName: r[2],
        CreatedDate: r[3],
        Deadline: r[4],
        Revision1: r[5],
        Revision2: r[6],
        FinalDate: r[7],
        Revisions: r[8],
        Priority: r[9],
        Status: r[10],
        Followup: r[11],
        Taskcompletedapproval: r[13] || "Pending",
      }));

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// APPROVE / UNAPPROVE TASK
// ======================================================
router.patch("/approve/:id", auth, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { approvalStatus } = req.body;
    if (!approvalStatus) return res.status(400).json({ error: "approvalStatus is required" });

    const sheets = await getSheets();
    const fetch = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A2:R`,
    });

    const rows = fetch.data.values || [];
    const idx = rows.findIndex((r) => r[0] === taskId);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    while (rows[idx].length < 14) rows[idx].push("");

    if (approvalStatus === "Approved") {
      rows[idx][13] = "Approved";
      rows[idx][10] = "Completed";
      rows[idx][7] = formatDateDDMMYYYYHHMMSS(); // IST final date
    } else {
      rows[idx][13] = "Pending";
      rows[idx][7] = "";
      rows[idx][12] = "";
      rows[idx][10] = "Pending";
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID_DELEGATION,
      range: `${SHEET_NAME}!A${idx + 2}:R${idx + 2}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [rows[idx]] },
    });

    res.json({ ok: true, updated: rows[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
