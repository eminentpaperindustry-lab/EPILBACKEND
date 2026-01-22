const express = require("express");
const axios = require("axios");
const auth = require("../middleware/auth.js");

const router = express.Router();

// Approved WhatsApp template name for both checklist and delegation
const TEMPLATE_NAME = "pendingtask";

router.post("/send-checklist", auth, async (req, res) => {
  const { number, employeeName, tasks } = req.body;

  if (!number || !employeeName || !tasks || !Array.isArray(tasks)) {
    return res.status(400).json({ success: false, message: "Missing fields or tasks must be array" });
  }

  // Format task list with emoji numbers and line breaks
  let taskListStr = tasks
    .map((task, index) => `${index + 1}️⃣ ${task}`)
    .join("\n");

  // Truncate if too long to prevent API errors
  if (taskListStr.length > 1000) taskListStr = taskListStr.slice(0, 1000) + "...";

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.META_WA_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: number,
        type: "template",
        template: {
          name: TEMPLATE_NAME,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: employeeName },
                { type: "text", text: String(tasks.length) },
                { type: "text", text: taskListStr }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_WA_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({ success: true, message: "WhatsApp checklist sent ✅", data: response.data });
  } catch (error) {
    console.error("WhatsApp checklist send error:", error.response?.data || error.message);
    return res.status(500).json({ success: false, message: "WhatsApp checklist send failed", error: error.response?.data || error.message });
  }
});

router.post("/send-delegation", auth, async (req, res) => {
  const { number, employeeName, delegations } = req.body;

  if (!number || !employeeName || !delegations || !Array.isArray(delegations)) {
    return res.status(400).json({ success: false, message: "Missing fields or delegations must be array" });
  }

  // Format delegation list with emoji numbers and line breaks
  let delegationListStr = delegations
    .map((delegation, index) => `${index + 1}️⃣ ${delegation}`)
    .join("\n");

  // Truncate if too long
  if (delegationListStr.length > 1000) delegationListStr = delegationListStr.slice(0, 1000) + "...";

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${process.env.META_WA_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: number,
        type: "template",
        template: {
          name: TEMPLATE_NAME,  // Use different template name if needed
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: employeeName },
                { type: "text", text: String(delegations.length) },
                { type: "text", text: delegationListStr }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.META_WA_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({ success: true, message: "WhatsApp delegation sent ✅", data: response.data });
  } catch (error) {
    console.error("WhatsApp delegation send error:", error.response?.data || error.message);
    return res.status(500).json({ success: false, message: "WhatsApp delegation send failed", error: error.response?.data || error.message });
  }
});

module.exports = router;
