/**
 * كنوز الفيروز - استقبال الأوردرات من Landing Pages
 * ====================================================
 * طريقة التركيب:
 * 1. افتح Google Sheet جديد، سمّيه "كنوز الفيروز - الأوردرات"
 * 2. من القائمة: Extensions > Apps Script
 * 3. امسح أي كود موجود، والصق هذا الكود كامل
 * 4. اضغط Deploy > New deployment
 * 5. اختر النوع: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. اضغط Deploy، وانسخ الرابط (Web app URL)
 * 9. الصق الرابط ده في صفحات المنتج بدل YOUR_GOOGLE_APPS_SCRIPT_URL
 *
 * ملاحظة تحديث: لو بتعدّل على كود موجود بالفعل وشغال (مش أول تركيب)،
 * لازم تعمل Deploy > Manage deployments > عدّل (✏️) > New version
 * عشان التعديل يسري على نفس الرابط القديم من غير ما يتغيّر.
 *
 * ملاحظة Meta Conversions API: عشان حدث الـ Purchase يتبعت لفيسبوك من السيرفر
 * (بيشتغل حتى لو العميل شغّال عنده Adblocker)، لازم تضيف Script Property اسمها
 * META_CAPI_TOKEN وقيمتها Access Token من Events Manager > Settings > Conversions API.
 * لو الخاصية دي مش موجودة، الكود بيتجاهل إرسال الحدث بهدوء من غير ما يبوّظ تسجيل الطلب.
 */

const SHEET_NAME = "الأوردرات";
const SECRET_TOKEN = "abe2e2fe3b99476556ade4192aec051e772c10a4c9cb881ff7770536a713ab73";
const META_PIXEL_ID = "2165511077625659";

// أقل مدة مسموحة بين طلبين من نفس رقم الهاتف (بالثواني) — لمنع تكرار/سبام الطلبات
const RATE_LIMIT_SECONDS = 60;

// أسماء الأعمدة بالترتيب
const HEADERS = [
  "التاريخ والوقت",
  "رقم الطلب",
  "نوع المنتج",
  "اسم العرض",
  "الكمية",
  "سعر الوحدة",
  "الإجمالي",
  "اسم العميل",
  "رقم الهاتف",
  "المحافظة",
  "العنوان بالتفصيل",
  "طريقة الدفع",
  "مصدر الإعلان",
  "حالة الطلب",
  "ملاحظات"
];

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // لو الشيت فاضي، حط العناوين وظبط الشكل
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#0D0D0D");
    headerRange.setFontColor("#C9A84C");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.setRightToLeft(true);

    // ظبط عرض الأعمدة
    sheet.setColumnWidth(1, 140);  // التاريخ
    sheet.setColumnWidth(2, 90);   // رقم الطلب
    sheet.setColumnWidth(3, 110);  // نوع المنتج
    sheet.setColumnWidth(4, 160);  // اسم العرض
    sheet.setColumnWidth(11, 220); // العنوان
    sheet.setColumnWidth(13, 150); // مصدر الإعلان
  }

  return sheet;
}

/**
 * يمنع Formula/CSV Injection: لو القيمة نص وبيبدأ بـ = أو + أو - أو @
 * جوجل شيتس ممكن يفسرها كصيغة (formula) بدل ما يعاملها كنص عادي.
 * الحل القياسي: نحط علامة اقتباس مفردة (') في الأول تجبر الخلية تتعامل كنص خالص.
 */
function sanitizeCell(value) {
  if (typeof value !== "string") return value;
  if (/^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

/**
 * تحقق بسيط من معدل الطلبات لنفس رقم الهاتف خلال RATE_LIMIT_SECONDS
 * باستخدام CacheService (مشترك بين كل تشغيلات السكريبت).
 */
function isRateLimited(phone) {
  if (!phone) return false;
  const cache = CacheService.getScriptCache();
  const key = "order_rl_" + phone;
  if (cache.get(key)) return true;
  cache.put(key, "1", RATE_LIMIT_SECONDS);
  return false;
}

/**
 * تحويل نص لـ SHA-256 hex — Meta بتطلب بيانات العميل (زي رقم الهاتف)
 * تتبعت مشفّرة بالطريقة دي، مش نص واضح.
 */
function sha256Hex(input) {
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8);
  return rawHash.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

/**
 * تطبيع رقم الهاتف المصري لصيغة دولية (بادئة 20) قبل التشفير،
 * عشان يطابق الفورمات اللي Meta متوقعاه.
 */
function normalizeEgyptPhone(phone) {
  let digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) {
    digits = "20" + digits.substring(1);
  } else if (!digits.startsWith("20")) {
    digits = "20" + digits;
  }
  return digits;
}

/**
 * بعت حدث Purchase مباشرة من السيرفر (Apps Script) لـ Meta Conversions API.
 * الاتصال ده Google-to-Meta وميعديش على متصفح العميل خالص، فبيشتغل حتى لو
 * عند العميل Adblocker بيوقف الـ Pixel العادي في المتصفح.
 * أي فشل هنا بيتسجل في اللوج بس وميأثرش على نجاح تسجيل الطلب في الشيت.
 */
function sendMetaPurchaseEvent(data, orderId) {
  const token = PropertiesService.getScriptProperties().getProperty("META_CAPI_TOKEN");
  if (!token) return;

  try {
    const normalizedPhone = normalizeEgyptPhone(data.phone);
    const userData = {};
    if (normalizedPhone) userData.ph = [sha256Hex(normalizedPhone)];
    if (data.fbp) userData.fbp = data.fbp;
    if (data.fbc) userData.fbc = data.fbc;

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(orderId),
          action_source: "website",
          event_source_url: data.pageUrl || "",
          user_data: userData,
          custom_data: {
            currency: "EGP",
            value: Number(data.total) || 0,
            content_name: data.offer || "",
            content_type: "product",
            num_items: Number(data.qty) || 1
          }
        }
      ],
      access_token: token
    };

    const testEventCode = PropertiesService.getScriptProperties().getProperty("META_TEST_EVENT_CODE");
    if (testEventCode) payload.test_event_code = testEventCode;

    UrlFetchApp.fetch("https://graph.facebook.com/v21.0/" + META_PIXEL_ID + "/events", {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log("Meta CAPI error: " + err.toString());
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // التحقق من الـ token — لو غلط أو مش موجود، نرفض الطلب
    if (data.token !== SECRET_TOKEN) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // منع تكرار نفس رقم الهاتف خلال فترة قصيرة (سبام/دبل كليك)
    if (isRateLimited(data.phone)) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "rate_limited" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = getOrCreateSheet();

    const orderId = data.orderId || Math.floor(100000 + Math.random() * 900000);

    const row = [
      data.timestamp || new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }),
      orderId,
      data.productType || "",      // زيت / عسل / باكيج
      data.offer || "",            // اسم العرض
      data.qty || "",
      data.unit_price || "",
      data.total || "",
      data.name || "",
      data.phone || "",
      data.gov || "",
      data.address || "",
      data.payment || "",
      data.source || "مباشر",
      "في انتظار التأكيد",         // حالة الطلب الافتراضية
      ""                           // ملاحظات (فاضية يدوياً)
    ].map(sanitizeCell);

    sheet.appendRow(row);

    // تلوين عمود الحالة باللون الأصفر للطلبات الجديدة
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 14).setBackground("#FFF3CD");

    // إرسال حدث Purchase لـ Meta من السيرفر مباشرة (يشتغل حتى لو فيه Adblocker)
    sendMetaPurchaseEvent(data, orderId);

    return ContentService
      .createTextOutput(JSON.stringify({ status: "success", orderId: orderId }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: "ok", message: "كنوز الفيروز - Orders API شغال" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * فنكشن اختباري - شغّله يدوي من الـ Apps Script Editor
 * (اختار testWrite من قايمة Select function واضغط Run)
 * لو اشتغل صح، هتلاقي صف جديد في الشيت بكلمة "اختبار يدوي"
 */
function testWrite() {
  const sheet = getOrCreateSheet();
  sheet.appendRow([
    new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" }),
    "TEST-001",
    "اختبار",
    "اختبار يدوي",
    1, 100, 100,
    "اسم تجريبي",
    "01000000000",
    "القاهرة",
    "عنوان تجريبي",
    "الدفع عند الاستلام",
    "اختبار مباشر",
    "في انتظار التأكيد",
    "تم الإرسال من الـ Apps Script Editor مباشرة"
  ]);
  Logger.log("تمت الكتابة بنجاح");
}
