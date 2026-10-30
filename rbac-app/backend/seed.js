require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Permission = require("./models/Permission");
const Role = require("./models/Role");
const User = require("./models/User");

const PERMISSIONS = [
  ["users:read", "Xem danh sách và chi tiết người dùng"],
  ["users:create", "Tạo người dùng"],
  ["users:update", "Sửa thông tin, khóa/mở khóa người dùng"],
  ["users:delete", "Xóa người dùng"],
  ["roles:read", "Xem vai trò và quyền của vai trò"],
  ["roles:create", "Tạo vai trò"],
  ["roles:update", "Sửa vai trò, thay bộ quyền của vai trò"],
  ["roles:delete", "Xóa vai trò"],
  ["roles:assign", "Gán / gỡ vai trò cho người dùng"],
  ["permissions:read", "Xem danh mục quyền"],
].map(([code, description]) => ({ code, resource: code.split(":")[0], action: code.split(":")[1], description }));

// Ma trận quyền mục II.1.5
const ROLES = [
  {
    code: "super-admin", name: "Quản trị viên tối cao", isSystem: true,
    description: "Toàn quyền hệ thống",
    permissions: PERMISSIONS.map((p) => p.code),
  },
  {
    code: "user-manager", name: "Quản lý người dùng", isSystem: true,
    description: "Quản lý tài khoản và gán vai trò",
    permissions: ["users:read", "users:create", "users:update", "roles:read", "roles:assign", "permissions:read"],
  },
  {
    code: "auditor", name: "Kiểm toán viên", isSystem: true,
    description: "Chỉ xem người dùng, vai trò và danh mục quyền",
    permissions: ["users:read", "roles:read", "permissions:read"],
  },
  { code: "member", name: "Thành viên", isSystem: true, description: "Người dùng thông thường", permissions: [] },
  // Vai trò tự tạo (không phải hệ thống)
  {
    code: "tro-giang", name: "Trợ giảng", isSystem: false,
    description: "Hỗ trợ xem danh sách người dùng",
    permissions: ["users:read", "roles:read"],
  },
];

const ADMIN_PASSWORD = "Admin@2026";
const USER_PASSWORD = "User@2026";

// Bản thân ở vị trí đầu tiên. Các thành viên khác là dữ liệu mẫu – thay bằng tên/email thật trước khi nộp.
const USERS = [
  { email: "20242259M@sis.hust.edu.vn", fullName: "Phạm Gia Minh", phone: "+84912345678", password: ADMIN_PASSWORD, roles: ["super-admin"] },
  { email: "nguyen.van.an@sis.hust.edu.vn", fullName: "Nguyễn Văn An", phone: "+84901112233", roles: ["user-manager"] },
  { email: "phan.thanh.tung@sis.hust.edu.vn", fullName: "Phan Thanh Tùng", roles: ["user-manager"] },
  { email: "tran.thi.binh@sis.hust.edu.vn", fullName: "Trần Thị Bình", phone: "+84987654321", roles: ["auditor"] },
  { email: "vu.thi.ha@sis.hust.edu.vn", fullName: "Vũ Thị Hà", roles: ["tro-giang"] },
  { email: "le.van.cuong@sis.hust.edu.vn", fullName: "Lê Văn Cường", roles: ["member"] },
  { email: "hoang.thi.dung@sis.hust.edu.vn", fullName: "Hoàng Thị Dung", roles: ["member"] },
  { email: "do.minh.duc@sis.hust.edu.vn", fullName: "Đỗ Minh Đức", phone: "+84933445566", roles: ["member"] },
  { email: "nguyen.thu.giang@sis.hust.edu.vn", fullName: "Nguyễn Thu Giang", roles: ["member", "tro-giang"] },
  { email: "bui.quang.huy@sis.hust.edu.vn", fullName: "Bùi Quang Huy", roles: ["member"] },
  { email: "dang.thi.lan@sis.hust.edu.vn", fullName: "Đặng Thị Lan", roles: ["member"] },
  { email: "ngo.van.long@sis.hust.edu.vn", fullName: "Ngô Văn Long", roles: ["member"], status: "locked" },
  { email: "trinh.thi.mai@sis.hust.edu.vn", fullName: "Trịnh Thị Mai", roles: ["member"] },
  { email: "ly.hoang.nam@sis.hust.edu.vn", fullName: "Lý Hoàng Nam", roles: ["auditor"] },
  { email: "nguyen.minh.phuong@sis.hust.edu.vn", fullName: "Nguyễn Minh Phương", roles: ["member"] },
];

async function seed() {
  await Promise.all([Permission.deleteMany({}), Role.deleteMany({}), User.deleteMany({})]);
  await Promise.all([Permission.init(), Role.init(), User.init()]); // tạo unique index

  await Permission.insertMany(PERMISSIONS);
  const roles = await Role.insertMany(ROLES);
  const roleId = Object.fromEntries(roles.map((r) => [r.code, r._id]));

  const hashes = {
    [ADMIN_PASSWORD]: await bcrypt.hash(ADMIN_PASSWORD, 10),
    [USER_PASSWORD]: await bcrypt.hash(USER_PASSWORD, 10),
  };
  // Tạo tuần tự để createdAt tăng dần theo đúng thứ tự danh sách
  for (const u of USERS) {
    await User.create({
      email: u.email,
      fullName: u.fullName,
      phone: u.phone ?? null,
      status: u.status ?? "active",
      passwordHash: hashes[u.password ?? USER_PASSWORD],
      roles: u.roles.map((code) => roleId[code]),
    });
  }
  return { permissions: PERMISSIONS.length, roles: roles.length, users: USERS.length };
}

if (require.main === module) {
  (async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const r = await seed();
      console.log(`Đã tạo ${r.permissions} quyền, ${r.roles} vai trò, ${r.users} người dùng.`);
      console.log(`Đăng nhập: ${USERS[0].email} / ${ADMIN_PASSWORD} (super-admin); tài khoản khác mật khẩu ${USER_PASSWORD}.`);
    } catch (err) {
      console.error("Seed lỗi:", err.message);
      process.exitCode = 1;
    } finally {
      await mongoose.disconnect();
    }
  })();
}

module.exports = { seed, USERS, ADMIN_PASSWORD, USER_PASSWORD };
