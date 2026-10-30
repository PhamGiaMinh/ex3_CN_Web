const mongoose = require("mongoose");

// Gửi lỗi theo định dạng thống nhất { error: { code, message, details? } }
function fail(res, status, code, message, details) {
  const error = { code, message };
  if (details && details.length) error.details = details;
  return res.status(status).json({ error });
}

const detail = (field, issue, message) => ({ field, issue, message });

const VALIDATION_MSG = "Dữ liệu đầu vào không hợp lệ.";
const validationFail = (res, details) => fail(res, 400, "VALIDATION_ERROR", VALIDATION_MSG, details);

// Lỗi cho các trường không nằm trong allow-list (chống mass assignment)
function notAllowedFields(body, allowed) {
  return Object.keys(body || {})
    .filter((k) => !allowed.includes(k))
    .map((k) => detail(k, "FIELD_NOT_ALLOWED", `Trường '${k}' không được phép gửi lên endpoint này.`));
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isObjectId = (id) =>
  typeof id === "string" && mongoose.isValidObjectId(id) && String(new mongoose.Types.ObjectId(id)) === id;

// ---- Kiểm tra từng trường (dùng chung cho POST/PATCH) ----
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const ROLE_CODE_RE = /^[a-z][a-z0-9-]{2,49}$/;

function checkEmail(value, details) {
  if (value === undefined || value === null || value === "") return details.push(detail("email", "REQUIRED", "Email không được để trống."));
  if (typeof value !== "string" || !EMAIL_RE.test(value.trim()))
    details.push(detail("email", "INVALID_VALUE", "Email không đúng định dạng."));
}

function checkName(field, value, details, label) {
  if (value === undefined || value === null || value === "") return details.push(detail(field, "REQUIRED", `${label} không được để trống.`));
  if (typeof value !== "string") return details.push(detail(field, "INVALID_TYPE", `${label} phải là chuỗi.`));
  const len = value.trim().length;
  if (len < 2 || len > 100) details.push(detail(field, "INVALID_LENGTH", `${label} phải có 2–100 ký tự.`));
}

function checkPhone(value, details) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !PHONE_RE.test(value.trim()))
    details.push(detail("phone", "INVALID_VALUE", "Số điện thoại theo định dạng E.164, ví dụ +84912345678."));
}

// "" hoặc null -> null; chuỗi -> trim
const normalizePhone = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());

// ---- Query: phân trang, sắp xếp, tìm kiếm ----
function parsePaging(query, details) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 10 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) details.push(detail("page", "INVALID_VALUE", "page phải là số nguyên ≥ 1."));
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) details.push(detail("limit", "OUT_OF_RANGE", "limit phải trong khoảng 1–100."));
  return { page, limit };
}

// sort=-createdAt,fullName -> { createdAt: -1, fullName: 1 }
function parseSort(raw, allowed, details) {
  const sort = {};
  if (typeof raw !== "string") {
    details.push(detail("sort", "INVALID_VALUE", "sort phải là chuỗi."));
    return sort;
  }
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const field = part.replace(/^-/, "");
    if (!allowed.includes(field)) {
      details.push(detail("sort", "FIELD_NOT_SORTABLE", `Không sắp xếp được theo '${field}'. Cho phép: ${allowed.join(", ")}.`));
      continue;
    }
    sort[field] = part.startsWith("-") ? -1 : 1;
  }
  return sort;
}

// Thoát ký tự đặc biệt trước khi đưa từ khóa vào $regex
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pageMeta = (page, limit, totalItems) => ({ page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) });

// ---- Biểu diễn tài nguyên: CHỈ chọn trường được phép trả ra ----
const roleSummary = (r) => ({ id: String(r._id), code: r.code, name: r.name });

function userView(u) {
  return {
    id: String(u._id),
    email: u.email,
    fullName: u.fullName,
    phone: u.phone ?? null,
    status: u.status,
    roles: (u.roles || []).filter((r) => r && r.code).map(roleSummary),
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function roleView(r, userCount) {
  return {
    id: String(r._id),
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    isSystem: r.isSystem,
    permissions: [...r.permissions],
    userCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const permissionView = (p) => ({ code: p.code, resource: p.resource, action: p.action, description: p.description });

module.exports = {
  fail, detail, validationFail, notAllowedFields, isPlainObject, isObjectId,
  EMAIL_RE, PHONE_RE, PASSWORD_RE, ROLE_CODE_RE, checkEmail, checkName, checkPhone, normalizePhone,
  parsePaging, parseSort, escapeRegex, pageMeta,
  userView, roleView, roleSummary, permissionView,
};
