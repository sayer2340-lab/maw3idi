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
const supabaseConfigured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = supabaseConfigured ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
const sms = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const smsSender = process.env.TWILIO_SENDER_ID?.trim();
const smsMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

app.use(express.json());
app.use(express.static(__dirname, { setHeaders: response => response.setHeader("Cache-Control", "no-store") }));

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
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

async function sendSms(to, body) {
  if (!sms) throw new Error("Twilio غير مهيأ على الخادم");
  const normalizedPhone = normalizePhone(to);
  if (!normalizedPhone || normalizedPhone.length < 10) throw new Error("رقم جوال المستلم غير صالح");
  try {
    const message = { body, to: normalizedPhone };
    if (smsMessagingServiceSid) message.messagingServiceSid = smsMessagingServiceSid;
    else if (smsSender) message.from = smsSender;
    else throw new Error("أضف TWILIO_MESSAGING_SERVICE_SID أو TWILIO_SENDER_ID في Render");
    return await sms.messages.create(message);
  } catch (error) {
    throw new Error(`Twilio ${error.code || "error"}: ${error.message}`);
  }
}

async function sendNearTurnReminders(appointments) {
  if (!appointments.length) return;
  const patientIds = appointments.map(appointment => appointment.patient_id);
  const patients = await supabase.from("patients").select("id,name,phone").in("id", patientIds);
  if (patients.error) throw patients.error;
  const patientsById = new Map(patients.data.map(patient => [patient.id, patient]));
  for (const appointment of appointments) {
    const patient = patientsById.get(appointment.patient_id);
    if (!patient?.phone) continue;
    try {
      const text = appointment.people_ahead === 0
        ? `موعدي: حان دور ${patient.name} الآن.`
        : `موعدي: تبقى ${appointment.people_ahead} مراجعين قبل دور ${patient.name}.`;
      await sendSms(patient.phone, text);
      await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
    } catch (error) {
      console.error("Near-turn SMS error:", error.message);
    }
  }
}

function appointmentForClient(appointment = {}) {
  return {
    ...appointment,
    patientId: appointment.patient_id ?? appointment.patientId ?? null,
    patientName: appointment.patient_name ?? appointment.patientName ?? null,
    patientPhone: appointment.phone ?? appointment.patientPhone ?? null,
    doctorId: appointment.doctor_id ?? appointment.doctorId ?? null,
    doctorName: appointment.doctor_name ?? appointment.doctorName ?? null,
    clinicName: appointment.clinic_name ?? appointment.clinicName ?? null,
    date: appointment.appointment_date ?? appointment.date ?? null,
    time: appointment.appointment_time ?? appointment.time ?? null,
    queueNumber: appointment.queue_number ?? appointment.queueNumber ?? null,
    peopleAhead: appointment.people_ahead ?? appointment.peopleAhead ?? 0,
    reminder: Boolean(appointment.reminder_sent_at ?? appointment.reminder)
  };
}

app.get("/api/health", async (_req, res) => {
  if (!supabaseConfigured) return res.status(503).json({ ok: false, supabaseConfigured: false, twilioConfigured: Boolean(sms && (smsMessagingServiceSid || smsSender)), error: "أضف متغيرات Supabase في Render" });
  const { error } = await supabase.from("users").select("id").limit(1);
  res.status(error ? 503 : 200).json({ ok: !error, supabaseConfigured: true, databaseReachable: !error, twilioConfigured: Boolean(sms && (smsMessagingServiceSid || smsSender)), databaseError: error?.message });
});

app.post("/api/login", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "الخادم غير مهيأ ببيانات Supabase" });
  try {
    const { username, password, role } = req.body || {};
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const { data, error } = await supabase.from("users").select("id,name,username,password_hash,role").ilike("username", normalizedUsername).eq("role", role).maybeSingle();
    if (error) return res.status(500).json({ error: `تعذر الاتصال بقاعدة البيانات: ${error.message}` });
    if (!data || !verifyPassword(password, data.password_hash)) return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    res.json({ id: data.id, name: data.name, role: data.role });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "حدث خطأ أثناء تسجيل الدخول" });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  const [patients, appointments, doctors, users] = await Promise.all([
    supabase.from("patients").select("*"),
    supabase.from("appointments").select("*").order("appointment_date"),
    supabase.from("doctors").select("*").order("name"),
    supabase.from("users").select("id,name,username,role,phone,birth").eq("role", "staff")
  ]);
  const failed = [patients, appointments, doctors, users].find(result => result.error);
  if (failed) return res.status(500).json({ error: `تعذر تحميل بيانات لوحة التحكم: ${failed.error.message}` });
  res.json({ patients: patients.data, appointments: appointments.data.map(appointmentForClient), doctors: doctors.data, users: users.data });
});

app.post("/api/appointments", async (req, res) => {
  const data = req.body || {};
  const { name, phone, birth, gender, blood, notes, date, period, doctorId, doctorName, clinicName, type } = data;
  if (!name || !phone || !birth || !date || !period || !doctorId || !type) return res.status(400).json({ error: "البيانات المطلوبة ناقصة" });
  const { data: existingPatient, error: patientLookupError } = await supabase.from("patients").select("*").eq("phone", phone).maybeSingle();
  if (patientLookupError) return res.status(500).json({ error: `تعذر قراءة بيانات المراجع: ${patientLookupError.message}` });
  let patient = existingPatient;
  if (!patient) {
    const created = await supabase.from("patients").insert({ name, phone, birth, gender, blood, notes }).select().single();
    if (created.error) return res.status(500).json({ error: `تعذر حفظ بيانات المراجع: ${created.error.message}` });
    patient = created.data;
  }
  const queue = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("appointment_date", date).eq("period", period).eq("doctor_id", doctorId).neq("status", "ملغى");
  if (queue.error) return res.status(500).json({ error: `تعذر حساب الدور: ${queue.error.message}` });
  if (queue.count >= 40) return res.status(409).json({ error: "اكتملت حجوزات هذه الفترة لهذا الدكتور" });
  const appointmentTime = period === "morning" ? "08:00" : "16:00";
  const appointment = await supabase.from("appointments").insert({ patient_id: patient.id, patient_name: patient.name, phone: patient.phone, birth: patient.birth, doctor_id: doctorId, doctor_name: doctorName || null, clinic_name: clinicName || null, appointment_date: date, period, appointment_time: appointmentTime, date, time: appointmentTime, queue_number: queue.count + 1, people_ahead: queue.count, type, status: "مؤكد" }).select("*").single();
  if (appointment.error) return res.status(500).json({ error: `تعذر حفظ الموعد: ${appointment.error.message}` });
  let smsSent = false;
  let smsError = null;
  try {
    await sendSms(phone, `موعدي: تم حجز موعدك بتاريخ ${date}، الدور رقم ${queue.count + 1}. سيتم تذكيرك عند اقتراب دورك.`);
    smsSent = true;
  } catch (error) {
    smsError = error.message;
    console.error("SMS error:", error.message);
  }
  res.status(201).json({ appointment: appointmentForClient(appointment.data), smsSent, smsError });
});

app.patch("/api/appointments/:id", async (req, res) => {
  const data = req.body || {};
  const update = { appointment_date: data.date, period: data.period, appointment_time: data.period === "morning" ? "08:00" : "16:00", doctor_id: Number(data.doctorId), doctor_name: data.doctorName || null, clinic_name: data.clinicName || null, type: data.type, status: data.status };
  const { data: appointment, error } = await supabase.from("appointments").update(update).eq("id", req.params.id).select("*").single();
  if (error) return res.status(500).json({ error: "تعذر تعديل الموعد" });
  res.json({ appointment: appointmentForClient(appointment) });
});

app.post("/api/appointments/:id/confirm", async (req, res) => {
  const current = await supabase.from("appointments").select("id,people_ahead,status,appointment_date,date,period,doctor_id").eq("id", req.params.id).single();
  if (current.error || current.data.status !== "مؤكد") return res.status(409).json({ error: "لا يمكن تأكيد هذا الموعد" });
  const appointmentDate = current.data.appointment_date || current.data.date;
  const { data: appointment, error } = await supabase.from("appointments").update({ status: "قيد الكشف", doctor_entered_at: new Date().toISOString() }).eq("id", req.params.id).select("*").single();
  if (error) return res.status(500).json({ error: "تعذر تحديث حالة الموعد" });
  const waiting = await supabase.from("appointments").select("id,patient_id,people_ahead,reminder_sent_at").eq("appointment_date", appointmentDate).eq("period", current.data.period).eq("doctor_id", current.data.doctor_id).eq("status", "مؤكد").gt("people_ahead", 0);
  if (!waiting.error) {
    for (const next of waiting.data) {
      await supabase.from("appointments").update({ people_ahead: Math.max(0, Number(next.people_ahead) - 1) }).eq("id", next.id);
    }
    const near = waiting.data.filter(next => !next.reminder_sent_at && Number(next.people_ahead) - 1 <= 5);
    await sendNearTurnReminders(near);
  }
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
  if (!process.env.REMINDER_CRON_SECRET || req.get("x-cron-secret") !== process.env.REMINDER_CRON_SECRET) return res.status(401).json({ error: "غير مصرح" });
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from("appointments").select("id,patient_id,people_ahead,appointment_date,doctor_id,clinic_name").eq("status", "مؤكد").gte("appointment_date", today).is("reminder_sent_at", null).lte("people_ahead", 5).limit(50);
  if (error) return res.status(500).json({ error: `تعذر تحميل التذكيرات: ${error.message}` });
  const patientIds = data.map(appointment => appointment.patient_id);
  const patients = await supabase.from("patients").select("id,name,phone").in("id", patientIds);
  if (patients.error) return res.status(500).json({ error: `تعذر تحميل بيانات المراجعين للتذكير: ${patients.error.message}` });
  const patientsById = new Map(patients.data.map(patient => [patient.id, patient]));
  let sent = 0;
  let failed = 0;
  const failures = [];
  for (const appointment of data) {
    try {
      const patient = patientsById.get(appointment.patient_id);
      if (!patient?.phone) continue;
      const text = appointment.people_ahead === 0 ? `موعدي: حان دور ${patient.name} الآن.` : `موعدي: تبقى ${appointment.people_ahead} مراجعين قبل دور ${patient.name}.`;
      await sendSms(patient.phone, text);
      await supabase.from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", appointment.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      failures.push({ appointmentId: appointment.id, error: error.message });
      console.error("Reminder error:", error.message);
    }
  }
  res.json({ sent, candidates: data.length, failed, failures });
});

app.listen(port, () => console.log(`Maw3idi server listening on ${port}`));
