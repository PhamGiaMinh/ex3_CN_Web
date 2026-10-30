const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Role = require("../models/Role");
const { authenticate, requirePermission } = require("../middleware/auth");
const { missingPermissions, isLastSuperAdmin, removingLastSuperAdmin } = require("../utils/rbac");
const {
  fail, detail, validationFail, notAllowedFields, isPlainObject, isObjectId,
  PASSWORD_RE, checkEmail, checkName, checkPhone, normalizePhone,
  parsePaging, parseSort, escapeRegex, pageMeta, userView, roleSummary,
} = require("../utils/http");

const router = express.Router();
router.use(authenticate); // mọi endpoint dưới đây đều cần đăng nhập

const LAST_SA_MSG = "Phải còn ít nhất một quản trị viên tối cao (super-admin) đang hoạt động.";

// Middleware nạp user theo :userId (bỏ qua user đã xóa mềm)
async function loadUser(req, res, next) {
  const { userId } = req.params;
  const user = isObjectId(userId) ? await User.findOne({ _id: userId, status: { $ne: "deleted" } }).populate("roles") : null;
  if (!user) return fail(res, 404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
  req.target = user;
  next();
}

// Middleware nạp role theo :roleId
async function loadRole(req, res, next) {
  const { roleId } = req.params;
  const role = isObjectId(roleId) ? await Role.findById(roleId) : null;
  if (!role) return fail(res, 404, "ROLE_NOT_FOUND", "Không tìm thấy vai trò.");
  req.role = role;
  next();
}

// Body của POST/PATCH phải là object JSON
function requireObjectBody(req, res, next) {
  if (!isPlainObject(req.body)) return validationFail(res, [detail("body", "INVALID_TYPE", "Body phải là đối tượng JSON.")]);
  next();
}

const isSelf = (req) => String(req.target._id) === String(req.user._id);

// ===== GET /users – danh sách (tìm kiếm, lọc, phân trang) =====
router.get("/", requirePermission("users:read"), async (req, res) => {
  const q = req.query;
  const details = [];
  const { page, limit } = parsePaging(q, details);
  const sort = parseSort(q.sort === undefined ? "-createdAt" : q.sort, ["fullName", "email", "createdAt", "lastLoginAt"], details);
  if (q.status !== undefined && !["active", "locked"].includes(q.status))
    details.push(detail("status", "INVALID_VALUE", "status phải là active hoặc locked."));
  if (q.roleId !== undefined && !isObjectId(q.roleId))
    details.push(detail("roleId", "INVALID_VALUE", "roleId phải là ObjectId hợp lệ."));
  if (q.q !== undefined && (typeof q.q !== "string" || q.q.trim().length < 2))
    details.push(detail("q", "TOO_SHORT", "Từ khóa tìm kiếm phải có tối thiểu 2 ký tự."));
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);

  const filter = { status: q.status || { $ne: "deleted" } };
  if (q.roleId) filter.roles = q.roleId; // mảng chứa phần tử roleId
  if (q.q) {
    const re = { $regex: escapeRegex(q.q.trim()), $options: "i" };
    filter.$or = [{ fullName: re }, { email: re }];
  }

  const [items, totalItems] = await Promise.all([
    User.find(filter).sort({ ...sort, _id: 1 }).skip((page - 1) * limit).limit(limit).populate("roles"),
    User.countDocuments(filter),
  ]);
  res.json({ data: items.map(userView), meta: pageMeta(page, limit, totalItems) });
});

// ===== POST /users – tạo người dùng =====
router.post("/", requirePermission("users:create"), requireObjectBody, async (req, res) => {
  const body = req.body;
  // 1. Allow-list + validation
  const details = notAllowedFields(body, ["email", "fullName", "phone", "password", "roleIds"]);
  checkEmail(body.email, details);
  checkName("fullName", body.fullName, details, "Họ tên");
  checkPhone(body.phone, details);
  if (!body.password) details.push(detail("password", "REQUIRED", "Mật khẩu không được để trống."));
  else if (typeof body.password !== "string" || !PASSWORD_RE.test(body.password))
    details.push(detail("password", "WEAK_PASSWORD", "Mật khẩu tối thiểu 8 ký tự, có chữ hoa, chữ số và ký tự đặc biệt."));
  if (body.roleIds !== undefined && (!Array.isArray(body.roleIds) || !body.roleIds.every(isObjectId)))
    details.push(detail("roleIds", "INVALID_VALUE", "roleIds phải là mảng ObjectId hợp lệ."));
  if (details.length) return validationFail(res, details);

  // 2. Vai trò: có roleIds -> cần roles:assign, mọi role phải tồn tại, không vượt quyền người gọi
  let roles;
  const roleIds = [...new Set(body.roleIds || [])];
  if (roleIds.length) {
    if (!req.permissions.has("roles:assign")) return fail(res, 403, "FORBIDDEN", "Gán vai trò khi tạo người dùng cần quyền roles:assign.");
    roles = await Role.find({ _id: { $in: roleIds } });
    if (roles.length !== roleIds.length) return fail(res, 400, "ROLE_NOT_FOUND", "Có vai trò không tồn tại trong roleIds.");
    const missing = missingPermissions(roles.flatMap((r) => r.permissions), req.permissions);
    if (missing.length)
      return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gán vai trò có quyền bạn không có: ${missing.join(", ")}.`);
  } else {
    roles = await Role.find({ code: "member" }); // mặc định
  }

  // 3. Email trùng -> 409 (kiểm tra trước để trả lỗi rõ ràng; unique index là lưới an toàn)
  const email = body.email.trim().toLowerCase();
  if (await User.exists({ email })) return fail(res, 409, "EMAIL_ALREADY_EXISTS", "Email đã được sử dụng.");

  // 4. Tạo
  const user = await User.create({
    email,
    fullName: body.fullName.trim(),
    phone: normalizePhone(body.phone),
    passwordHash: await bcrypt.hash(body.password, 10),
    roles: roles.map((r) => r._id),
  });
  await user.populate("roles");
  res.status(201).location(`${req.baseUrl}/${user._id}`).json(userView(user));
});

// ===== GET /users/:userId – chi tiết =====
router.get("/:userId", requirePermission("users:read"), loadUser, (req, res) => res.json(userView(req.target)));

// ===== PATCH /users/:userId – cập nhật một phần, khóa/mở khóa =====
router.patch("/:userId", requirePermission("users:update"), requireObjectBody, loadUser, async (req, res) => {
  const body = req.body;
  const details = notAllowedFields(body, ["fullName", "phone", "email", "status"]);
  if ("email" in body) checkEmail(body.email, details);
  if ("fullName" in body) checkName("fullName", body.fullName, details, "Họ tên");
  if ("phone" in body) checkPhone(body.phone, details);
  if ("status" in body && !["active", "locked"].includes(body.status))
    details.push(detail("status", "INVALID_VALUE", "status chỉ nhận active hoặc locked."));
  if (details.length) return validationFail(res, details);

  const user = req.target;
  if (body.status === "locked" && user.status !== "locked") {
    if (isSelf(req)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự khóa tài khoản của mình.");
    if (await isLastSuperAdmin(user)) return fail(res, 409, "LAST_SUPER_ADMIN", LAST_SA_MSG);
  }
  if ("email" in body) {
    const email = body.email.trim().toLowerCase();
    if (email !== user.email && (await User.exists({ email, _id: { $ne: user._id } })))
      return fail(res, 409, "EMAIL_ALREADY_EXISTS", "Email đã được sử dụng.");
    user.email = email;
  }
  // Chỉ gán trường được gửi lên – trường không gửi giữ nguyên
  if ("fullName" in body) user.fullName = body.fullName.trim();
  if ("phone" in body) user.phone = normalizePhone(body.phone);
  if ("status" in body) user.status = body.status;
  await user.save(); // save() chạy lại validator của schema
  res.json(userView(user));
});

// ===== DELETE /users/:userId – xóa mềm =====
router.delete("/:userId", requirePermission("users:delete"), loadUser, async (req, res) => {
  if (isSelf(req)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự xóa tài khoản của mình.");
  if (await isLastSuperAdmin(req.target)) return fail(res, 409, "LAST_SUPER_ADMIN", LAST_SA_MSG);
  req.target.status = "deleted";
  await req.target.save();
  res.status(204).end();
});

// ===== GET /users/:userId/roles – vai trò của người dùng =====
router.get("/:userId/roles", requirePermission("users:read"), loadUser, (req, res) => {
  const data = req.target.roles.filter(Boolean).map(roleSummary);
  res.json({ data, meta: { totalItems: data.length } });
});

// ===== (Mở rộng) GET /users/:userId/permissions – quyền hiệu lực + nguồn gốc =====
router.get("/:userId/permissions", requirePermission("users:read"), loadUser, (req, res) => {
  const sources = new Map(); // code -> [roleSummary]
  for (const role of req.target.roles.filter(Boolean)) {
    for (const code of role.permissions) {
      if (!sources.has(code)) sources.set(code, []);
      sources.get(code).push(roleSummary(role));
    }
  }
  const data = [...sources.keys()].sort().map((code) => ({ code, sources: sources.get(code) }));
  res.json({ data, meta: { totalItems: data.length } });
});

// ===== PUT /users/:userId/roles/:roleId – gán vai trò (idempotent) =====
router.put("/:userId/roles/:roleId", requirePermission("roles:assign"), loadUser, loadRole, async (req, res) => {
  const missing = missingPermissions(req.role.permissions, req.permissions);
  if (missing.length)
    return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gán vai trò '${req.role.code}' vì bạn không có quyền: ${missing.join(", ")}.`);
  await User.updateOne({ _id: req.target._id }, { $addToSet: { roles: req.role._id } }); // không tạo bản trùng
  res.status(204).end();
});

// ===== DELETE /users/:userId/roles/:roleId – gỡ vai trò (idempotent) =====
router.delete("/:userId/roles/:roleId", requirePermission("roles:assign"), loadUser, loadRole, async (req, res) => {
  if (isSelf(req)) return fail(res, 403, "SELF_ACTION_FORBIDDEN", "Bạn không thể tự gỡ vai trò của mình.");
  const missing = missingPermissions(req.role.permissions, req.permissions);
  if (missing.length)
    return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể gỡ vai trò '${req.role.code}' vì bạn không có quyền: ${missing.join(", ")}.`);
  if (await removingLastSuperAdmin(req.target, req.role._id))
    return fail(res, 409, "LAST_SUPER_ADMIN", LAST_SA_MSG);
  await User.updateOne({ _id: req.target._id }, { $pull: { roles: req.role._id } });
  res.status(204).end();
});

module.exports = router;
