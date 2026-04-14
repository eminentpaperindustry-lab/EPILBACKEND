const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require('fs');
const path = require('path');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ======================================================
// ✅ YEH LINE ADD KARNI HAI - Profile pictures ke liye
// ======================================================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ROUTES
const authRoutes = require("./routes/auth");
const adminAuth = require("./routes/adminAuth");
const delegationsRoutes = require("./routes/delegations");
const supportTicketsRoutes = require("./routes/supportTickets");
const checklistRoutes = require("./routes/checklist");
const employeeRouter = require("./routes/employee");
const helpTicketsRouter = require("./routes/helpTickets");
const additionalFeature = require("./routes/additionalFeature");
const allDashboard = require('./routes/allDashboard');
const whatsappRoutes = require("./routes/whatsapp.js");

// API prefix
app.use("/api/auth", authRoutes);
app.use("/api/adminauth", adminAuth);
app.use("/api/additionalfeature", additionalFeature);
app.use("/api/delegations", delegationsRoutes);
app.use("/api/support-tickets", supportTicketsRoutes);
app.use("/api/checklist", checklistRoutes);
app.use("/api/employee", employeeRouter);
app.use("/api/helpTickets", helpTicketsRouter);
app.use("/api/delegations", require("./routes/delegations"));
app.use("/api/allDashboard", allDashboard);
app.use("/api/whatsapp", whatsappRoutes);

// ======================================================
// TRACKING FILE FOR AUTO-GENERATE
// ======================================================
const TRACK_FILE = path.join(__dirname, 'last-generate.txt');

// Check if already generated for this month
const isAlreadyGenerated = () => {
  try {
    if (fs.existsSync(TRACK_FILE)) {
      const lastMonth = fs.readFileSync(TRACK_FILE, 'utf8');
      const today = new Date();
      const currentMonth = `${today.getMonth() + 1}-${today.getFullYear()}`;
      return lastMonth === currentMonth;
    }
  } catch (err) {
    console.log('Track file error:', err.message);
  }
  return false;
};

// Mark as generated
const markAsGenerated = () => {
  try {
    const today = new Date();
    const currentMonth = `${today.getMonth() + 1}-${today.getFullYear()}`;
    fs.writeFileSync(TRACK_FILE, currentMonth);
    console.log(`✅ Marked ${currentMonth} as generated`);
  } catch (err) {
    console.log('Error marking as generated:', err.message);
  }
};

// ======================================================
// AUTO-GENERATE FUNCTION - RENDER FRIENDLY
// ======================================================
const generateTasks = async () => {
  console.log('📅 ==================================');
  console.log(`📅 Auto-generate check at: ${new Date().toLocaleString()}`);
  
  try {
    // Pehle check karo ki is month already generate hua ya nahi
    if (isAlreadyGenerated()) {
      console.log('⏭️ This month already generated, skipping');
      console.log('📅 ==================================');
      return;
    }
    
    console.log('🚀 Generating tasks...');
    
    // ✅ RENDER KE LIYE - BASE_URL use karo
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    
    const response = await fetch(`${baseUrl}/api/checklist/auto-generate-next-month`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-job': 'true'  // 👈 YEH HEADER ADD KARO
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Generated ${data.createdTasks?.length || 0} tasks`);
      markAsGenerated();
    } else {
      console.log('❌ Generation failed:', data.error || 'Unknown error');
    }
    
  } catch (err) {
    console.log('❌ Error:', err.message);
  }
  
  console.log('📅 ==================================');
};

// ======================================================
// CRON JOB - Har 1 ghante mein check
// ======================================================
const cron = require('node-cron');

cron.schedule('0 * * * *', () => {
  console.log('⏰ Hourly check running...');
  generateTasks();
});

// ======================================================
// SERVER START PE CHECK
// ======================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📅 Checking if generation needed on startup...');
  
  setTimeout(() => {
    generateTasks();
  }, 5000);
});

// ======================================================
// HEALTH CHECK API
// ======================================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    generated: isAlreadyGenerated() ? 'yes' : 'no',
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });
});

// ======================================================
// ADMIN MANUAL TRIGGER
// ======================================================
app.post('/admin/generate-now', async (req, res) => {
  try {
    console.log('👨‍💼 Manual trigger by admin');
    await generateTasks();
    res.json({ success: true, message: 'Generation triggered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});