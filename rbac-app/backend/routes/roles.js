const express = require("express");
const Role = require("../models/Role");
const User = require("../models/User");
const Permission = require("../models/Permission");
const { authenticate, requirePermission } = require("../middleware/auth");
const { missingPermissions, countUsers } = require("../utils/rbac");
const {
  fail, detail, validationFail, notAllowedFields, isPlainObject, isObjectId, ROLE_CODE_RE, checkName,
  parsePaging, parseSort, escapeRegex, pageMeta, roleView, permissionView, userView,
} = require("../utils/http");

const router = express.Router();
router.use(authenticate);

async function loadRole(req, res, next) {
  const { roleId } = req.params;
  const role = isObjectId(roleId) ? await Role.findById(roleId) : null;
  if (!role) return fail(res, 404, "ROLE_NOT_FOUND", "Không tìm thấy vai trò.");
  req.role = role;
  next();
}

function requireObjectBody(req, res, next) {
  if (!isPlainObject(req.body)) return validationFail(res, [detail("body", "INVALID_TYPE", "Body phải là đối tượng JSON.")]);
  next();
}

// Kiểm tra mảng mã quyền: đúng kiểu và tồn tại trong danh mục. Trả null nếu hợp lệ.
async function checkPermissionList(perms) {
  if (!Array.isArray(perms) || !perms.every((p) => typeof p === "string"))
    return { status: 400, code: "VALIDATION_ERROR", message: "Dữ liệu đầu vào không hợp lệ.", details: [detail("permissions", "INVALID_TYPE", "permissions phải là mảng mã quyền.")] };
  const known = new Set((await Permission.find({ code: { $in: perms } })).map((p) => p.code));
  const unknown = [...new Set(perms.filter((p) => !known.has(p)))];
  if (unknown.length)
    return {
      status: 400, code: "PERMISSION_NOT_FOUND", message: `Quyền không tồn tại: ${unknown.join(", ")}.`,
      details: unknown.map((p) => detail("permissions", "NOT_FOUND", `Quyền '${p}' không tồn tại.`)),
    };
  return null;
}

function checkDescription(value, details) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") details.push(detail("description", "INVALID_TYPE", "description phải là chuỗi."));
  else if (value.length > 500) details.push(detail("description", "INVALID_LENGTH", "Mô tả tối đa 500 ký tự."));
}
const normalizeDescription = (v) => (v === undefined || v === null || v.trim() === "" ? null : v.trim());

const SYSTEM_MSG = "Vai trò hệ thống không được xóa hoặc thay đổi bộ quyền.";

// ===== GET /roles =====
router.get("/", requirePermission("roles:read"), async (req, res) => {
  const q = req.query;
  const details = [];
  const { page, limit } = parsePaging(q, details);
  const sort = parseSort(q.sort === undefined ? "name" : q.sort, ["name", "code", "createdAt"], details);
  if (q.q !== undefined && (typeof q.q !== "string" || !q.q.trim()))
    details.push(detail("q", "INVALID_VALUE", "Từ khóa tìm kiếm không hợp lệ."));
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);

  const filter = {};
  if (q.q) {
    const re = { $regex: escapeRegex(q.q.trim()), $options: "i" };
    filter.$or = [{ name: re }, { code: re }];
  }
  const [roles, totalItems] = await Promise.all([
    Role.find(filter).sort({ ...sort, _id: 1 }).skip((page - 1) * limit).limit(limit),
    Role.countDocuments(filter),
  ]);
  const counts = await Promise.all(roles.map((r) => countUsers(r._id)));
  res.json({ data: roles.map((r, i) => roleView(r, counts[i])), meta: pageMeta(page, limit, totalItems) });
});

// ===== POST /roles =====
router.post("/", requirePermission("roles:create"), requireObjectBody, async (req, res) => {
  const body = req.body;
  const details = notAllowedFields(body, ["code", "name", "description", "permissions"]);
  if (!body.code) details.push(detail("code", "REQUIRED", "Mã vai trò không được để trống."));
  else if (typeof body.code !== "string" || !ROLE_CODE_RE.test(body.code.trim()))
    details.push(detail("code", "INVALID_VALUE", "Mã vai trò: chữ thường, số, gạch nối; 3–50 ký tự; bắt đầu bằng chữ."));
  checkName("name", body.name, details, "Tên vai trò");
  checkDescription(body.description, details);
  if (details.length) return validationFail(res, details);

  const permissions = [...new Set(body.permissions ?? [])];
  const permError = await checkPermissionList(body.permissions ?? []);
  if (permError) return fail(res, permError.status, permError.code, permError.message, permError.details);

  // Chống leo thang: chỉ được cấp cho vai trò những quyền mình có (BR-02)
  const missing = missingPermissions(permissions, req.permissions);
  if (missing.length) return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể cấp quyền bạn không có: ${missing.join(", ")}.`);

  const code = body.code.trim();
  if (await Role.exists({ code })) return fail(res, 409, "ROLE_CODE_EXISTS", `Mã vai trò '${code}' đã tồn tại.`);

  const role = await Role.create({ code, name: body.name.trim(), description: normalizeDescription(body.description), permissions });
  res.status(201).location(`${req.baseUrl}/${role._id}`).json(roleView(role, 0));
});

// ===== GET /roles/:roleId =====
router.get("/:roleId", requirePermission("roles:read"), loadRole, async (req, res) => {
  res.json(roleView(req.role, await countUsers(req.role._id)));
});

// ===== PATCH /roles/:roleId – chỉ name, description =====
router.patch("/:roleId", requirePermission("roles:update"), requireObjectBody, loadRole, async (req, res) => {
  const body = req.body;
  const details = notAllowedFields(body, ["name", "description"]);
  if ("name" in body) checkName("name", body.name, details, "Tên vai trò");
  if ("description" in body) checkDescription(body.description, details);
  if (details.length) return validationFail(res, details);

  const role = req.role;
  if ("name" in body) role.name = body.name.trim();
  if ("description" in body) role.description = normalizeDescription(body.description);
  await role.save();
  res.json(roleView(role, await countUsers(role._id)));
});

// ===== DELETE /roles/:roleId =====
router.delete("/:roleId", requirePermission("roles:delete"), loadRole, async (req, res) => {
  if (req.role.isSystem) return fail(res, 409, "SYSTEM_ROLE_PROTECTED", SYSTEM_MSG);
  const inUse = await countUsers(req.role._id);
  if (inUse > 0) return fail(res, 409, "ROLE_IN_USE", `Vai trò đang được gán cho ${inUse} người dùng, không thể xóa.`);
  await Role.deleteOne({ _id: req.role._id });
  // Dọn tham chiếu còn sót ở người dùng đã xóa mềm
  await User.updateMany({ roles: req.role._id }, { $pull: { roles: req.role._id } });
  res.status(204).end();
});

// ===== GET /roles/:roleId/permissions =====
router.get("/:roleId/permissions", requirePermission("roles:read"), loadRole, async (req, res) => {
  const perms = await Permission.find({ code: { $in: req.role.permissions } }).sort({ resource: 1, code: 1 });
  res.json({ data: perms.map(permissionView), meta: { totalItems: perms.length } });
});

// ===== PUT /roles/:roleId/permissions – thay toàn bộ bộ quyền =====
router.put("/:roleId/permissions", requirePermission("roles:update"), requireObjectBody, loadRole, async (req, res) => {
  const body = req.body;
  const details = notAllowedFields(body, ["permissions"]);
  if (body.permissions === undefined) details.push(detail("permissions", "REQUIRED", "Thiếu permissions."));
  if (details.length) return validationFail(res, details);

  const permError = await checkPermissionList(body.permissions);
  if (permError) return fail(res, permError.status, permError.code, permError.message, permError.details);

  const role = req.role;
  if (role.isSystem) return fail(res, 409, "SYSTEM_ROLE_PROTECTED", SYSTEM_MSG);

  // Chống leo thang trên PHẦN THAY ĐỔI: quyền thêm vào và quyền bị bớt đi đều phải là quyền mình có
  const next = [...new Set(body.permissions)];
  const added = next.filter((p) => !role.permissions.includes(p));
  const removed = role.permissions.filter((p) => !next.includes(p));
  const missing = missingPermissions([...added, ...removed], req.permissions);
  if (missing.length)
    return fail(res, 403, "PRIVILEGE_ESCALATION", `Không thể thêm/bớt quyền bạn không có: ${missing.join(", ")}.`);

  role.permissions = next;
  await role.save();
  res.json(roleView(role, await countUsers(role._id)));
});

// ===== (Mở rộng) GET /roles/:roleId/users – người dùng mang vai trò =====
router.get("/:roleId/users", requirePermission("roles:read", "users:read"), loadRole, async (req, res) => {
  const details = [];
  const { page, limit } = parsePaging(req.query, details);
  if (details.length) return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", details);
  const filter = { roles: req.role._id, status: { $ne: "deleted" } };
  const [items, totalItems] = await Promise.all([
    User.find(filter).sort({ fullName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).populate("roles"),
    User.countDocuments(filter),
  ]);
  res.json({ data: items.map(userView), meta: pageMeta(page, limit, totalItems) });
});

module.exports = router;
