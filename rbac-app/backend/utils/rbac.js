const Role = require("../models/Role");
const User = require("../models/User");

// Những quyền trong danh sách mà người gọi KHÔNG có (dùng chống leo thang đặc quyền – BR-02)
const missingPermissions = (codes, myPermissions) => [...new Set(codes)].filter((c) => !myPermissions.has(c));

const hasRole = (user, roleId) => user.roles.some((r) => String(r._id || r) === String(roleId));

// user có phải super-admin ACTIVE cuối cùng không (BR-04)
async function isLastSuperAdmin(user) {
  if (user.status !== "active") return false;
  const sa = await Role.findOne({ code: "super-admin" });
  if (!sa || !hasRole(user, sa._id)) return false;
  const others = await User.countDocuments({ _id: { $ne: user._id }, status: "active", roles: sa._id });
  return others === 0;
}

// Gỡ roleId khỏi user có làm hệ thống mất super-admin active cuối cùng không
async function removingLastSuperAdmin(user, roleId) {
  const sa = await Role.findOne({ code: "super-admin" });
  return !!sa && String(sa._id) === String(roleId) && (await isLastSuperAdmin(user));
}

// Số người dùng (chưa bị xóa) đang mang vai trò
const countUsers = (roleId) => User.countDocuments({ roles: roleId, status: { $ne: "deleted" } });

module.exports = { missingPermissions, hasRole, isLastSuperAdmin, removingLastSuperAdmin, countUsers };
