import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 10000);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sms = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

app.use(express.json());
app.use(express.static(__dirname));

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/[^0-9+]/g, "");
  if (digits.startsWith("05")) return `+966${digits.slice(1)}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function sendSms(to, body) {
  if (!sms) throw new Error("Twilio غير مهيأ على الخادم");
  return sms.messages.create({ body, from: process.env.TWILIO_PHONE_NUMBER, to: normalizePhone(to) });
}

function appointmentForClient(appointment) {
  return {
    ...appointment,
    patientId: appointment.patient_id,
    doctorId: appointment.doctor_id,
    doctorName: appointment.doctor_name,
    clinicName: appointment.clinic_name,
    date: appointment.appointment_date,
    time: appointment.appointment_time,
    queueNumber: appointment.queue_number,
    peopleAhead: appointment.people_ahead,
    reminder: Boolean(appointment.reminder_sent_at)
  };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY), twilioConfigured: Boolean(sms && process.env.TWILIO_PHONE_NUMBER) }));

app.post("/api/login", async (req, res) => {
  const { username, password, role } = req.body || {};
  const normalizedUsername = String(username || "").trim().toLowerCase();
  const { data, error } = await supabase.from("users").select("id,name,username,password_hash,role").ilike("username", normalizedUsername).eq("role", role).maybeSingle();
  if (error) return res.status(500).json({ error: `تعذر الاتصال بقاعدة البيانات: ${error.message}` });
  if (!data || !verifyPassword(password, data.password_hash)) return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  res.json({ id: data.id, name: data.name, role: data.role });
});

app.get("/api/dashboard", async (_req, res) => {
  const [patients, appointments, doctors, users] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("appointments").select("*, patients(*), doctors(*)").order("appointment_date").order("appointment_time"),
    supabase.from("doctors").select("*").order("name"),
    supabase.from("users").select("id,name,username,role,phone,birth").eq("role", "staff")
  ]);
  const failed = [patients, appointments, doctors, users].find(result => result.error);
  if (failed) return res.status(500).json({ error: "تعذر تحميل بيانات لوحة التحكم" });
  res.json({ patients: patients.data, appointments: appointments.data.map(appointmentForClient), doctors: doctors.data, users: users.data });
});

app.post("/api/appointments", async (req, res) => {
  const data = req.body || {};
  const { name, phone, birth, gender, blood, notes, date, period, doctorId, doctorName, clinicName, type } = data;
  if (!name || !phone || !birth || !date || !period || !doctorId || !type) return res.status(400).json({ error: "البيانات المطلوبة ناقصة" });
  const { data: existingPatient, error: patientLookupError } = await supabase.from("patients").select("*").eq("phone", phone).maybeSingle();
  if (patientLookupError) return res.status(500).json({ error: "تعذر قراءة بيانات المراجع" });
  let patient = existingPatient;
  if (!patient) {
    const created = await supabase.from("patients").insert({ name, phone, birth, gender, blood, notes }).select().single();
    if (created.error) return res.status(500).json({ error: "تعذر حفظ بيانات المراجع" });
    patient = created.data;
  }
  const queue = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("appointment_date", date).eq("period", period).eq("doctor_id", doctorId).neq("status", "ملغى");
  if (queue.error) return res.status(500).json({ error: "تعذر حساب الدور" });
  if (queue.count >= 40) return res.status(409).json({ error: "اكتملت حجوزات هذه الفترة لهذا الدكتور" });
  const appointment = await supabase.from("appointments").insert({ patient_id: patient.id, doctor_id: doctorId, doctor_name: doctorName || null, clinic_name: clinicName || null, appointment_date: date, period, appointment_time: period === "morning" ? "08:00" : "16:00", queue_number: queue.count + 1, people_ahead: queue.count, type, status: "مؤكد" }).select("*, patients(*)").single();
  if (appointment.error) return res.status(500).json({ error: "تعذر حفظ الموعد" });
  let smsSent = false;
  try {
    await sendSms(phone, `موعدي: تم حجز موعدك بتاريخ ${date}، الدور رقم ${queue.count + 1}. سيتم تذكيرك عند اقتراب دورك.`);
    smsSent = true;
  } catch (error) {
    console.error("SMS error:", error.message);
  }
  res.status(201).json({ appointment: appointment.data, smsSent });
});

app.patch("/api/appointments/:id", async (req, res) => {
  const data = req.body || {};
  const update = { appointment_date: data.date, period: data.period, appointment_time: data.period === "morning" ? "08:00" : "16:00", doctor_id: Number(data.doctorId), doctor_name: data.doctorName || null, clinic_name: data.clinicName || null, type: data.type, status: data.status };
  const { data: appointment, error } = await supabase.from("appointments").update(update).eq("id", req.params.id).select("*, patients(*)").single();
  if (error) return res.status(500).json({ error: "تعذر تعديل الموعد" });
  res.json({ appointment: appointmentForClient(appointment) });
});

app.post("/api/appointments/:id/confirm", async (req, res) => {
  const current = await supabase.from("appointments").select("people_ahead,status").eq("id", req.params.id).single();
  if (current.error || current.data.status !== "مؤكد") return res.status(409).json({ error: "لا يمكن تأكيد هذا الموعد" });
  const { data: appointment, error } = await supabase.from("appointments").update({ people_ahead: Math.max(0, Number(current.data.people_ahead || 0) - 1), status: "قيد الكشف", doctor_entered_at: new Date().toISOString() }).eq("id", req.params.id).select("*, patients(*)").single();
  if (error) return res.status(500).json({ error: "تعذر تحديث حالة الموعد" });
  res.json({ appointment: appointmentForClient(appointment) });
});

app.post("/api/staff", async (req, res) => {
  const data = req.body || {};
  if (!data.name || !data.username || !data.password) return res.status(400).json({ error: "بيانات الموظف ناقصة" });
  const { data: staff, error } = await supabase.from("users").insert({ name: data.name, birth: data.birth || null, phone: data.phone || null, username: data.username.trim(), password_hash: hashPassword(data.password), role: "staff" }).select("id,name,username,role,phone,birth").single();
  if (error) return res.status(409).json({ error: "اسم المستخدم مستخدم مسبقًا أو تعذر حفظ الموظف" });
  res.status(201).json({ staff });
});

app.post("/api/reminders/run", async (req, res) => {
  if (req.get("x-cron-secret") !== process.env.REMINDER_CRON_SECRET) return res.status(401).json({ error: "غير مصرح" });
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from("appointments").select("id,people_ahead,appointment_date,doctor_id,patients(name,phone),clinics:clinic_name").eq("status", "مؤكد").gte("appointment_date", today).is("reminder_sent_at", null).lte("people_ahead", 5).limit(50);
  if (error) return res.status(500).json({ error: "تعذر تحميل التذكيرات" });
  let sent = 0;
  for (const appointment of data) {
    try {
      const text = appointment.people_ahead === 0 ? `موعدي: حان دور ${appointment.patients.name} الآن.` : `موعدي: تبقى ${appointment.people_ahead} مراجعين قبل دور ${appointment.patients.name}.`;
      await sendSms(appointment.patients.phone, text);
      await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
      sent += 1;
    } catch (error) {
      console.error("Reminder error:", error.message);
    }
  }
  res.json({ sent });
});

app.listen(port, () => console.log(`Maw3idi server listening on ${port}`));
