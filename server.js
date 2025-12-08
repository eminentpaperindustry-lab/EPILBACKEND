const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ROUTES

  console.log("process.env server: ",process.env);

const authRoutes = require("./routes/auth");
const delegationsRoutes = require("./routes/delegations");
const supportTicketsRoutes = require("./routes/supportTickets");
const checklistRoutes = require("./routes/checklist");
const employeeRouter = require("./routes/employee");
const helpTicketsRouter = require("./routes/helpTickets");

// API prefix
app.use("/api/auth", authRoutes);
app.use("/api/delegations", delegationsRoutes);
app.use("/api/support-tickets", supportTicketsRoutes);
app.use("/api/checklist", checklistRoutes);
app.use("/api/employee", employeeRouter);
app.use("/api/helpTickets", helpTicketsRouter);
app.use("/api/delegations", require("./routes/delegations"));


app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));
