const express = require("express");
const Permission = require("../models/Permission");
const { authenticate, requirePermission } = require("../middleware/auth");
const { fail, detail, permissionView } = require("../utils/http");

const router = express.Router();
router.use(authenticate);

// GET /permissions – danh mục quyền (chỉ đọc). Express tự gắn ETag cho response GET
// và trả 304 Not Modified khi client gửi If-None-Match khớp.
router.get("/", requirePermission("permissions:read"), async (req, res) => {
  const { resource } = req.query;
  if (resource !== undefined && (typeof resource !== "string" || !resource.trim()))
    return fail(res, 400, "INVALID_QUERY_PARAMETER", "Tham số truy vấn không hợp lệ.", [detail("resource", "INVALID_VALUE", "resource không hợp lệ.")]);

  const filter = resource ? { resource: resource.trim() } : {};
  const perms = await Permission.find(filter).sort({ resource: 1, code: 1 });
  res.set("Cache-Control", "private, no-cache"); // luôn hỏi lại server, dùng ETag để nhận 304
  res.json({ data: perms.map(permissionView), meta: { totalItems: perms.length } });
});

module.exports = router;
