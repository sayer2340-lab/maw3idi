import "dotenv/config";

const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
const response = await fetch(`${baseUrl}/api/reminders/run`, {
  method: "POST",
  headers: { "x-cron-secret": process.env.REMINDER_CRON_SECRET }
});
if (!response.ok) throw new Error(`Reminder request failed: ${response.status} ${await response.text()}`);
console.log(await response.text());
