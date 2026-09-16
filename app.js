const DB_KEY = "maw3idi-clinic-db";
const SESSION_KEY = "maw3idi-clinic-session";
const API_BASE = `${window.location.origin}/api`;
let remoteDb = null;
const seed = {
  users: [
    { id: 1, name: "مدير المستوصف", username: "admin", password: "admin123", role: "admin" },
    { id: 2, name: "سارة أحمد", username: "staff", password: "staff123", role: "staff" }
  ],
  patients: [
    { id: 1, name: "محمد عبدالله", phone: "0501234567", birth: "1988-04-12", gender: "ذكر", blood: "O+", notes: "حساسية من البنسلين" }
  ],

  doctors: [
    { id: 1, name: 'د. أحمد محمد', specialty: 'طب عام' },
    { id: 2, name: 'د. نورة خالد', specialty: 'طب الأطفال' },
    { id: 3, name: 'د. سامي عبدالله', specialty: 'الأسنان' },
    { id: 4, name: 'د. ريم العتيبي', specialty: 'نساء وولادة' }
  ],
  appointments: [
    { id: 1, patientId: 1, date: "2026-09-09", time: "09:30", peopleAhead: 1, type: "عيادة عامة", status: "مؤكد", reminder: true }
  ]
};
async function readDb() {
  if (remoteDb) return remoteDb;
  const response = await fetch(`${API_BASE}/dashboard`);
  const body = await response.text();
  let result;
  try { result = JSON.parse(body); } catch (_error) { result = {}; }
  if (!response.ok) throw new Error(result.error || `تعذر تحميل البيانات (${response.status})`);
  remoteDb = result;
  return remoteDb;
}
const saveDb = () => { remoteDb = null; };
const $ = selector => document.querySelector(selector);
const today = () => new Date().toISOString().slice(0, 10);
const formatDate = value => new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}
async function render() {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  if (!session) return renderLanding();
  try { await renderDashboard(session); } catch (error) { toast(error.message); }
}
function renderLanding() {
  $("#app").innerHTML = `<div class="landing">
    <section class="hero"><div class="logo">موعد<span>ي</span></div><h1>رعاية صحية تبدأ من موعد منظم.</h1><p>منصة بسيطة وآمنة لإدارة مراجعي المستوصف، تنظيم المواعيد، ومتابعة التذكيرات في مكان واحد.</p><div class="hero-art"><b></b><b></b><b></b></div></section>
    <section class="access"><div class="logo">موعد<span>ي</span></div><h2>مرحبًا بك</h2><p>اختر بوابة الدخول المناسبة لك للمتابعة.</p><div class="role-grid">
      <button class="role-card" data-login="admin"><span class="icon">⚙</span><strong>دخول المدير</strong><small>إدارة الموظفين، المراجعين، والمواعيد</small><span class="primary">الدخول إلى لوحة المدير ←</span></button>
      <button class="role-card" data-login="staff"><span class="icon">♙</span><strong>دخول الموظفين</strong><small>تسجيل بيانات المرضى وحجز المواعيد</small><span class="secondary">الدخول إلى بوابة الموظف ←</span></button>
    </div></section></div>`;
  document.querySelectorAll("[data-login]").forEach(button => button.onclick = () => renderLogin(button.dataset.login));
}
function renderLogin(role) {
  const label = role === "admin" ? "المدير" : "الموظف";
  $("#app").innerHTML = `<div class="login-wrap"><form class="login-card" id="login-form">
    <button type="button" class="back" id="back">← العودة للرئيسية</button><div class="logo">موعد<span>ي</span></div><h2>دخول ${label}</h2><p>أدخل بيانات الدخول للمتابعة إلى حسابك.</p>
    <label for="username">اسم المستخدم</label><input id="username" required autocomplete="username" placeholder="أدخل اسم المستخدم">
    <label for="password">كلمة المرور</label><input id="password" type="password" required autocomplete="current-password" placeholder="أدخل كلمة المرور">
    <button class="primary full">تسجيل الدخول</button><div class="hint">تجريبيًا: ${role === "admin" ? "admin / admin123" : "staff / staff123"}</div>
  </form></div>`;
  $("#back").onclick = renderLanding;
    $("#login-form").onsubmit = async event => {
    event.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: $("#username").value.trim(), password: $("#password").value, role }) });
      const body = await response.text();
      let result;
      try { result = JSON.parse(body); } catch (_error) { result = { error: `رد غير صالح من الخادم (${response.status})` }; }
      if (!response.ok) return toast(result.error || "تعذر تسجيل الدخول");
      localStorage.setItem(SESSION_KEY, JSON.stringify(result));
      render();
    } catch (error) {
      toast(`تعذر الوصول إلى خادم الموقع: ${error.message}`);
    }
  };
}
async function renderDashboard(session, page = "home") {
  const db = await readDb(); const isAdmin = session.role === "admin";
  const patients = db.patients; const appointments = db.appointments;
  const nav = isAdmin ? `<button class="nav-btn ${page === "home" ? "active" : ""}" data-page="home">▦ لوحة المتابعة</button><button class="nav-btn ${page === "staff" ? "active" : ""}" data-page="staff">♙ الموظفون</button><button class="nav-btn ${page === "patients" ? "active" : ""}" data-page="patients">♡ المراجعون</button>` : `<button class="nav-btn ${page === "home" ? "active" : ""}" data-page="home">▦ لوحة المتابعة</button><button class="nav-btn ${page === "patients" ? "active" : ""}" data-page="patients">♡ المراجعون</button><button class="nav-btn ${page === "new" ? "active" : ""}" data-page="new">＋ موعد جديد</button>`;
  $("#app").innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo">موعد<span>ي</span></div><div class="user-chip"><strong>${session.name}</strong><small>${isAdmin ? "مدير النظام" : "موظف استقبال"}</small></div><nav class="nav-list">${nav}</nav><button class="nav-btn" id="logout">↪ تسجيل الخروج</button></aside><section class="content"><div class="topbar"><div><h1>${pageTitle(page, isAdmin)}</h1><span class="date">${new Intl.DateTimeFormat("ar-SA", { dateStyle: "full" }).format(new Date())}</span></div>${!isAdmin && page === "home" ? '<button class="primary" id="new-appointment">＋ حجز موعد</button>' : ""}</div>${pageBody(page, db, isAdmin)}</section></div>`;
  $("#logout").onclick = () => { localStorage.removeItem(SESSION_KEY); render(); };
  document.querySelectorAll("[data-page]").forEach(button => button.onclick = () => renderDashboard(session, button.dataset.page));
  if ($("#new-appointment")) $("#new-appointment").onclick = () => renderDashboard(session, "new");
  bindPageEvents(session, page);
  checkQueueReminders(db);
}
const pageTitle = (page, admin) => page === "home" ? "صباح الخير، " + (admin ? "مدير المستوصف" : "فريق الاستقبال") : page === "new" ? "حجز موعد جديد" : page === "patients" ? "سجل المراجعين" : page === "staff-add" ? "إضافة موظف جديد" : page === "edit" ? "تعديل الموعد" : "إدارة الموظفين";
function pageBody(page, db, admin) {
  if (page === "new") return appointmentForm(db);
  if (page === "patients") return patientTable(db, admin);
  if (page === "staff-add") return staffForm();
  if (page === "edit") return appointmentEditForm(db, Number(sessionStorage.getItem("editAppointmentId")));
  if (page === "staff") return staffTable(db);
  const activeAppointments = db.appointments.filter(a => a.status === "مؤكد");
  const upcoming = Array.from(new Map(activeAppointments
    .filter(a => a.date >= today() && a.status === "مؤكد")
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .map(appointment => [appointment.patientId, appointment])).values()).slice(0, 5);
  return `<div class="stats"><div class="stat"><small>مواعيد اليوم</small><strong>${activeAppointments.filter(a => a.date === today()).length}</strong></div><div class="stat"><small>إجمالي المراجعين</small><strong>${db.patients.length}</strong></div><div class="stat"><small>مواعيد قادمة</small><strong class="accent">${activeAppointments.filter(a => a.date >= today()).length}</strong></div><div class="stat"><small>قائمة الانتظار النشطة</small><strong>${activeAppointments.filter(a => a.date >= today()).length}</strong></div><div class="stat"><small>الموظفون</small><strong>${db.users.filter(u => u.role === "staff").length}</strong></div></div><div class="grid-2"><div class="panel"><div class="section-title"><h2>المواعيد القادمة</h2><span class="badge">${upcoming.length} مواعيد</span></div>${upcoming.length ? upcoming.map(a => { const p = { name: a.patientName, phone: a.patientPhone }; const doctor = (db.doctors || []).find(x => x.id === a.doctorId); return `<div class="appointment"><div><strong>${a.patientName || "مراجع"}</strong><small>${formatDate(a.date)} · الفترة ${a.period === "morning" ? "الصباحية 08:00 - 12:00" : "المسائية 16:00 - 22:00"} · الدور ${a.queueNumber || "-"} · باقي ${a.peopleAhead || "0"} أشخاص · ${a.type} · ${a.clinicName || "عيادة غير محددة"} · ${a.doctorName || doctor?.name || "طبيب غير محدد"}</small></div><div><span class="badge">${a.status}</span>${!admin && a.status === "مؤكد" ? `<button class="primary confirm-appointment" data-id="${a.id}" type="button">تأكيد دخول الدكتور</button>` : ""}${Number(a.peopleAhead) <= 5 && p.phone ? `<a class="secondary whatsapp-reminder" target="_blank" rel="noopener" data-id="${a.id}" href="${whatsappLink(a, p)}">واتساب</a>` : ""}<button class="secondary edit-appointment" data-id="${a.id}" type="button">تعديل</button></div></div>`; }).join("") : '<div class="empty">لا توجد مواعيد قادمة</div>'}</div><div class="panel"><h2>تذكيرات النظام</h2><p>يتم حساب التذكير حسب الدور، ويظهر التنبيه عندما يتبقى للمراجع 5 أشخاص أو أقل.</p><div class="appointment"><div><strong>التذكير التلقائي</strong><small>مفعل لجميع المواعيد</small></div><span class="badge">مفعل</span></div></div></div>`;
}
function whatsappLink(appointment, patient) {
  let phone = String(patient.phone || "").replace(/[^0-9]/g, "");
  if (phone.startsWith("05")) phone = `966${phone.slice(1)}`;
  if (phone.startsWith("00")) phone = phone.slice(2);
  const message = `مرحبًا ${patient.name}، تبقى على دورك ${appointment.peopleAhead} مراجعين. يرجى الاستعداد للحضور إلى ${appointment.clinicName || "العيادة"}.`; 
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
function appointmentForm(db) {
  const doctors = db.doctors || seed.doctors;
  const doctorOptions = doctors.length ? doctors.map(doctor => `<option value="${doctor.id}">${doctor.name} - ${doctor.specialty}</option>`).join("") : `<option value="">لا يوجد أطباء مسجلون</option>`;
  return `<div class="panel"><h2>بيانات المراجع والموعد</h2><form id="appointment-form"><div class="form-grid"><div><label>اسم المراجع *</label><input name="name" required placeholder="الاسم الرباعي"></div><div><label>رقم الجوال *</label><input name="phone" required type="tel" placeholder="05xxxxxxxx"></div><div><label>تاريخ الميلاد *</label><input name="birth" required type="date"></div><div><label>الجنس</label><select name="gender"><option>ذكر</option><option>أنثى</option></select></div><div><label>تاريخ الموعد *</label><input name="date" required type="date" min="${today()}"></div><div><label>فترة الحجز *</label><select name="period" required><option value="morning">صباحية - 08:00 إلى 12:00</option><option value="evening">مسائية - 16:00 إلى 22:00</option></select></div><div><label>السعة المتبقية</label><output id="capacity-output">40 مراجعًا</output></div><div><label>الدكتور *</label><select name="doctorId" required>${doctorOptions}</select></div><div><label>اسم الدكتور يدويًا</label><input name="doctorName" placeholder="اختياري عند عدم وجوده بالقائمة"></div><div><label>اسم العيادة يدويًا</label><input name="clinicName" placeholder="مثال: عيادة القلب"></div><div><label>نوع الزيارة</label><select name="type"><option>عيادة عامة</option><option>طب الأطفال</option><option>الأسنان</option><option>عيادة النساء</option><option>المختبر</option></select></div><div><label>فصيلة الدم</label><select name="blood"><option>غير محدد</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option></select></div><div class="wide"><label>ملاحظات طبية</label><input name="notes" placeholder="حساسيات أو ملاحظات مهمة"></div></div><div class="form-actions"><button class="primary">حفظ الموعد وتفعيل التذكير</button><button type="button" class="secondary" id="cancel-form">إلغاء</button></div></form></div>`;
}
function appointmentEditForm(db, appointmentId) {
  const appointment = db.appointments.find(item => item.id === appointmentId);
    if (!appointment) return `<div class="panel"><div class="empty">لم يتم العثور على الموعد</div></div>`;
  const doctorOptions = (db.doctors || seed.doctors).map(doctor => `<option value="${doctor.id}" ${doctor.id === appointment.doctorId ? "selected" : ""}>${doctor.name} - ${doctor.specialty}</option>`).join("");
  const patient = db.patients.find(item => item.id === appointment.patientId);
      return `<div class="panel"><h2>تعديل موعد ${patient?.name || "المراجع"}</h2><form id="edit-appointment-form"><input type="hidden" name="id" value="${appointment.id}"><div class="form-grid"><div><label>تاريخ الموعد *</label><input name="date" required type="date" min="${today()}" value="${appointment.date || ""}"></div><div><label>فترة الحجز *</label><select name="period" required><option value="morning" ${appointment.period === "morning" ? "selected" : ""}>صباحية - 08:00 إلى 12:00</option><option value="evening" ${appointment.period === "evening" ? "selected" : ""}>مسائية - 16:00 إلى 22:00</option></select></div><div><label>رقم الدور التلقائي</label><output>${appointment.queueNumber || "-"}</output></div><div><label>الدكتور *</label><select name="doctorId" required>${doctorOptions}</select></div><div><label>اسم الدكتور يدويًا</label><input name="doctorName" value="${appointment.doctorName || ""}" placeholder="اختياري"></div><div><label>اسم العيادة يدويًا</label><input name="clinicName" value="${appointment.clinicName || ""}" placeholder="مثال: عيادة القلب"></div><div><label>نوع الزيارة</label><select name="type"><option ${appointment.type === "عيادة عامة" ? "selected" : ""}>عيادة عامة</option><option ${appointment.type === "طب الأطفال" ? "selected" : ""}>طب الأطفال</option><option ${appointment.type === "الأسنان" ? "selected" : ""}>الأسنان</option><option ${appointment.type === "عيادة النساء" ? "selected" : ""}>عيادة النساء</option><option ${appointment.type === "المختبر" ? "selected" : ""}>المختبر</option></select></div><div><label>حالة الموعد</label><select name="status"><option ${appointment.status === "مؤكد" ? "selected" : ""}>مؤكد</option><option ${appointment.status === "مكتمل" ? "selected" : ""}>مكتمل</option><option ${appointment.status === "ملغى" ? "selected" : ""}>ملغى</option></select></div></div><div class="form-actions"><button class="primary">حفظ التعديلات</button><button type="button" class="secondary" id="cancel-edit">إلغاء</button></div></form></div>`;
}function patientTable(db, admin) {
  return `<div class="panel"><div class="section-title"><h2>قائمة المراجعين</h2>${!admin ? '<button class="primary" id="add-patient">＋ إضافة موعد</button>' : ""}</div><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الجوال</th><th>تاريخ الميلاد</th><th>الجنس</th><th>المواعيد</th></tr></thead><tbody>${db.patients.map(p => `<tr><td><strong>${p.name}</strong></td><td>${p.phone}</td><td>${formatDate(p.birth)}</td><td>${p.gender}</td><td>${db.appointments.filter(a => a.patientId === p.id).length}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا يوجد مراجعون</td></tr>'}</tbody></table></div></div>`;
}
function staffForm() {
  return `<div class="panel"><h2>بيانات الموظف الجديد</h2><form id="staff-form"><div class="form-grid">
    <div><label>اسم الموظف *</label><input name="name" required placeholder="الاسم الرباعي"></div>
    <div><label>رقم الجوال *</label><input name="phone" required type="tel" placeholder="05xxxxxxxx"></div>
    <div><label>تاريخ الميلاد *</label><input name="birth" required type="date"></div>
    <div><label>اسم المستخدم *</label><input name="username" required autocomplete="username" placeholder="يستخدم لتسجيل الدخول"></div>
    <div><label>كلمة المرور *</label><input name="password" required type="password" minlength="6" autocomplete="new-password" placeholder="6 أحرف على الأقل"></div>
    </div><div class="form-actions"><button class="primary">حفظ الموظف</button><button type="button" class="secondary" id="cancel-staff">إلغاء</button></div></form></div>`;
}
function staffTable(db) { const staff = db.users.filter(u => u.role === "staff"); return `<div class="panel"><div class="section-title"><h2>الموظفون</h2><button class="primary" id="add-staff">＋ إضافة موظف</button></div><div class="table-wrap"><table><thead><tr><th>الموظف</th><th>تاريخ الميلاد</th><th>الجوال</th><th>اسم المستخدم</th><th>الحالة</th></tr></thead><tbody>${staff.map(u => `<tr><td><strong>${u.name}</strong></td><td>${u.birth ? formatDate(u.birth) : "غير محدد"}</td><td>${u.phone || "غير محدد"}</td><td>${u.username}</td><td><span class="badge">نشط</span></td></tr>`).join("")}</tbody></table></div></div>`; }
async function confirmDoctorEntry(session, appointmentId) {
  const response = await fetch(`${API_BASE}/appointments/${appointmentId}/confirm`, { method: "POST" });
  const result = await response.json();
  if (!response.ok) return toast(result.error || "لا يمكن تأكيد هذا الموعد");
  const remaining = Number(result.appointment.peopleAhead || 0);
  toast(remaining === 0 ? "حان دور المريض الآن" : `تم تأكيد دخول الدكتور، باقي ${remaining} أشخاص`);
  remoteDb = null;
  renderDashboard(session, "home");
}
function bindPageEvents(session, page) {
  document.querySelectorAll(".edit-appointment").forEach(button => button.onclick = () => { sessionStorage.setItem("editAppointmentId", button.dataset.id); renderDashboard(session, "edit"); });
  document.querySelectorAll(".confirm-appointment").forEach(button => button.onclick = () => confirmDoctorEntry(session, Number(button.dataset.id)));
  if ($("#cancel-edit")) $("#cancel-edit").onclick = () => { sessionStorage.removeItem("editAppointmentId"); renderDashboard(session, "home"); };
  if ($("#edit-appointment-form")) $("#edit-appointment-form").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const response = await fetch(`${API_BASE}/appointments/${data.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, doctorId: Number(data.doctorId) }) });
    const result = await response.json();
    if (!response.ok) return toast(result.error || "تعذر تعديل الموعد");
    remoteDb = null; sessionStorage.removeItem("editAppointmentId"); toast("تم تعديل الموعد بنجاح"); renderDashboard(session, "home");
  };
  if ($("#add-staff")) $("#add-staff").onclick = () => renderDashboard(session, "staff-add");
  if ($("#cancel-staff")) $("#cancel-staff").onclick = () => renderDashboard(session, "staff");
  if ($("#staff-form")) $("#staff-form").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const response = await fetch(`${API_BASE}/staff`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) return toast(result.error || "تعذر إضافة الموظف");
    remoteDb = null;
    toast("تمت إضافة الموظف بنجاح");
    renderDashboard(session, "staff");
  };
  if ($("#add-patient")) $("#add-patient").onclick = () => renderDashboard(session, "new");
  if ($("#cancel-form")) $("#cancel-form").onclick = () => renderDashboard(session, "home");
  if (!$("#appointment-form")) return;
  const updateCapacity = () => {
    const form = $("#appointment-form");
    const date = form.elements.date.value;
    const period = form.elements.period.value;
    const doctorId = Number(form.elements.doctorId.value);
    const booked = db.appointments.filter(appointment => appointment.date === date && appointment.period === period && appointment.doctorId === doctorId && appointment.status === "مؤكد").length;
    $("#capacity-output").textContent = `${Math.max(0, 40 - booked)} مراجعًا`;
  };
  [$("#appointment-form").elements.date, $("#appointment-form").elements.period, $("#appointment-form").elements.doctorId].forEach(field => field.addEventListener("change", updateCapacity));
  updateCapacity();
  $("#appointment-form").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const response = await fetch(`${API_BASE}/appointments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, doctorId: Number(data.doctorId) }) });
    const result = await response.json();
    if (!response.ok) return toast(result.error || "تعذر حفظ الموعد");
    remoteDb = null;
    toast(result.smsSent ? "تم حفظ الموعد وإرسال رسالة التذكير" : "تم حفظ الموعد، وتعذر إرسال الرسالة مؤقتًا");
    renderDashboard(session, "home");
  };
}
function checkQueueReminders(db) {
  const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  if (!session || !db.appointments.length) return;
  const activeAppointments = db.appointments.filter(appointment => appointment.status === "مؤكد" && appointment.date >= today() && Number.isFinite(Number(appointment.peopleAhead)));
  const reminders = activeAppointments.map(appointment => {
    const ahead = activeAppointments.filter(other => other.id !== appointment.id && other.date === appointment.date && other.doctorId === appointment.doctorId && other.peopleAhead < appointment.peopleAhead).length;
    return { appointment, ahead };
  }).filter(item => item.ahead >= 0 && item.ahead <= 5).sort((a, b) => a.ahead - b.ahead);
  if (!reminders.length) return;
  const item = reminders[0];
  const patient = db.patients.find(p => p.id === item.appointment.patientId);
  const message = item.ahead === 0 ? `حان دور ${patient?.name || "المراجع"} الآن` : `تذكير: باقي على دور ${patient?.name || "المراجع"} ${item.ahead} أشخاص`;
  toast(message);
  if ("Notification" in window && Notification.permission === "granted") new Notification("موعدي | تذكير بالدور", { body: message });
}
render();
