const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { authenticate } = require("../middleware/auth");
const {
  fail, detail, validationFail, notAllowedFields, isPlainObject,
  PASSWORD_RE, checkName, checkPhone, normalizePhone, userView,
} = require("../utils/http");

const router = express.Router();
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL || 3600);

// ---- (Mở rộng) Giới hạn số lần đăng nhập sai -> 429 ----
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_SECONDS || 900) * 1000;
const failedLogins = new Map(); // key "ip|email" -> { count, first }

function attemptsOf(key) {
  const entry = failedLogins.get(key);
  if (entry && Date.now() - entry.first > WINDOW_MS) {
    failedLogins.delete(key);
    return null;
  }
  return entry;
}

function recordFailure(key) {
  const entry = attemptsOf(key) || { count: 0, first: Date.now() };
  entry.count += 1;
  failedLogins.set(key, entry);
}

const meView = (user, permissions) => ({ ...userView(user), permissions: [...permissions].sort() });

// POST /auth/tokens – đăng nhập
router.post("/auth/tokens", async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {};
  const { grantType, email, password } = body;
  const details = [];
  if (grantType !== "password") details.push(detail("grantType", "UNSUPPORTED", "grantType phải là 'password'."));
  if (!email) details.push(detail("email", "REQUIRED", "Thiếu email."));
  else if (typeof email !== "string") details.push(detail("email", "INVALID_TYPE", "email phải là chuỗi."));
  if (!password) details.push(detail("password", "REQUIRED", "Thiếu mật khẩu."));
  else if (typeof password !== "string") details.push(detail("password", "INVALID_TYPE", "password phải là chuỗi."));
  if (details.length) return validationFail(res, details);

  const normalizedEmail = email.trim().toLowerCase();
  const key = `${req.ip}|${normalizedEmail}`;
  const entry = attemptsOf(key);
  if (entry && entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.first + WINDOW_MS - Date.now()) / 1000);
    res.set("Retry-After", String(retryAfter));
    return fail(res, 429, "TOO_MANY_LOGIN_ATTEMPTS", `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(retryAfter / 60)} phút.`);
  }

  const user = await User.findOne({ email: normalizedEmail, status: { $ne: "deleted" } }).select("+passwordHash");
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    recordFailure(key);
    // Sai email hay sai mật khẩu đều trả CÙNG một thông điệp -> không lộ email nào tồn tại
    return fail(res, 401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }
  failedLogins.delete(key);
  if (user.status === "locked") return fail(res, 403, "ACCOUNT_LOCKED", "Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.");

  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });

  // Payload chỉ chứa sub – không nhúng quyền vào token (BR-07)
  const accessToken = jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: ACCESS_TTL, algorithm: "HS256" });
  res.set("Cache-Control", "no-store");
  res.json({ tokenType: "Bearer", accessToken, expiresIn: ACCESS_TTL });
});

// GET /me – hồ sơ + vai trò + quyền hiệu lực
router.get("/me", authenticate, (req, res) => {
  res.json(meView(req.user, req.permissions));
});

// (Mở rộng) PATCH /me – tự sửa họ tên, số điện thoại
router.patch("/me", authenticate, async (req, res) => {
  if (!isPlainObject(req.body)) return validationFail(res, [detail("body", "INVALID_TYPE", "Body phải là đối tượng JSON.")]);
  const body = req.body;
  const details = notAllowedFields(body, ["fullName", "phone"]);
  if ("fullName" in body) checkName("fullName", body.fullName, details, "Họ tên");
  if ("phone" in body) checkPhone(body.phone, details);
  if (details.length) return validationFail(res, details);

  const user = req.user;
  if ("fullName" in body) user.fullName = body.fullName.trim();
  if ("phone" in body) user.phone = normalizePhone(body.phone);
  await user.save();
  res.json(meView(user, req.permissions));
});

// (Mở rộng) PUT /me/password – đổi mật khẩu của chính mình
router.put("/me/password", authenticate, async (req, res) => {
  if (!isPlainObject(req.body)) return validationFail(res, [detail("body", "INVALID_TYPE", "Body phải là đối tượng JSON.")]);
  const { currentPassword, newPassword } = req.body;
  const details = notAllowedFields(req.body, ["currentPassword", "newPassword"]);
  if (!currentPassword || typeof currentPassword !== "string") details.push(detail("currentPassword", "REQUIRED", "Thiếu mật khẩu hiện tại."));
  if (!newPassword || typeof newPassword !== "string") details.push(detail("newPassword", "REQUIRED", "Thiếu mật khẩu mới."));
  else if (!PASSWORD_RE.test(newPassword))
    details.push(detail("newPassword", "WEAK_PASSWORD", "Mật khẩu tối thiểu 8 ký tự, có chữ hoa, chữ số và ký tự đặc biệt."));
  if (details.length) return validationFail(res, details);

  const user = await User.findById(req.user._id).select("+passwordHash");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
    return validationFail(res, [detail("currentPassword", "INCORRECT_PASSWORD", "Mật khẩu hiện tại không đúng.")]);
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.status(204).end();
});

module.exports = router;
