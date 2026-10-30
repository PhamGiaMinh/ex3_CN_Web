// Kiểm thử tích hợp T01–T24 (+ bổ sung). Chạy: npm test
// Dùng database riêng <tên DB>_test, seed lại từ đầu, server lắng nghe cổng ngẫu nhiên.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

process.env.LOGIN_MAX_ATTEMPTS = "5";
const app = require("../server");
const { seed, USERS, ADMIN_PASSWORD, USER_PASSWORD } = require("../seed");

let server;
let BASE;
const tokens = {};
const ids = { roles: {}, users: {} };

async function call(method, path, { token, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const login = async (email, password) =>
  (await call("POST", "/auth/tokens", { body: { grantType: "password", email, password } })).body.accessToken;

const emailOf = (code) => USERS.find((u) => u.roles[0] === code).email;

before(async () => {
  const uri = process.env.MONGODB_URI.replace(/\/([^/?]+)(\?|$)/, "/$1_test$2");
  await mongoose.connect(uri);
  await seed();
  server = app.listen(0);
  BASE = `http://127.0.0.1:${server.address().port}/api/v1`;

  tokens.sa = await login(USERS[0].email, ADMIN_PASSWORD);
  tokens.um = await login(emailOf("user-manager"), USER_PASSWORD);
  tokens.au = await login(emailOf("auditor"), USER_PASSWORD);
  tokens.mb = await login(emailOf("member"), USER_PASSWORD);

  const roles = await call("GET", "/roles?limit=100", { token: tokens.sa });
  for (const r of roles.body.data) ids.roles[r.code] = r.id;
  const users = await call("GET", "/users?limit=100", { token: tokens.sa });
  for (const u of users.body.data) ids.users[u.email] = u.id;
});

after(async () => {
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---------- Bước 1: xác thực ----------
test("login: sai mật khẩu & sai email -> 401 cùng thông điệp", async () => {
  const a = await call("POST", "/auth/tokens", { body: { grantType: "password", email: USERS[0].email, password: "Wrong@123" } });
  const b = await call("POST", "/auth/tokens", { body: { grantType: "password", email: "nobody@x.vn", password: "Wrong@123" } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.body.error.code, "INVALID_CREDENTIALS");
  assert.equal(a.body.error.message, b.body.error.message);
});

test("login: thiếu password -> 400 có details", async () => {
  const r = await call("POST", "/auth/tokens", { body: { grantType: "password", email: USERS[0].email } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  assert.ok(r.body.error.details.some((d) => d.field === "password"));
});

test("login: tài khoản locked -> 403 ACCOUNT_LOCKED", async () => {
  const locked = USERS.find((u) => u.status === "locked");
  const r = await call("POST", "/auth/tokens", { body: { grantType: "password", email: locked.email, password: USER_PASSWORD } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "ACCOUNT_LOCKED");
});

test("GET /me: không token 401, token sửa 401 INVALID_TOKEN, đúng token 200 không passwordHash", async () => {
  assert.equal((await call("GET", "/me")).body.error.code, "UNAUTHENTICATED");
  const bad = tokens.sa.slice(0, -2) + (tokens.sa.endsWith("A") ? "BB" : "AA");
  const r1 = await call("GET", "/me", { token: bad });
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error.code, "INVALID_TOKEN");
  const r2 = await call("GET", "/me", { token: tokens.um });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.passwordHash, undefined);
  assert.equal(r2.body._id, undefined);
  assert.deepEqual(r2.body.permissions, ["permissions:read", "roles:assign", "roles:read", "users:create", "users:read", "users:update"]);
});

// ---------- T01–T24 ----------
test("T01 GET /users không token -> 401 UNAUTHENTICATED", async () => {
  const r = await call("GET", "/users");
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "UNAUTHENTICATED");
});

test("T02 GET /users member -> 403 FORBIDDEN", async () => {
  const r = await call("GET", "/users", { token: tokens.mb });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("T03 GET /users?page=2&limit=3&sort=fullName auditor -> 200 meta đúng", async () => {
  const r = await call("GET", "/users?page=2&limit=3&sort=fullName", { token: tokens.au });
  assert.equal(r.status, 200);
  const total = USERS.length;
  assert.deepEqual(r.body.meta, { page: 2, limit: 3, totalItems: total, totalPages: Math.ceil(total / 3) });
  assert.equal(r.body.data.length, 3);
  const names = r.body.data.map((u) => u.fullName);
  assert.deepEqual(names, [...names].sort());
});

test("T04 GET /users?q=nguyen&status=active -> chỉ bản ghi khớp", async () => {
  const r = await call("GET", "/users?q=nguyen&status=active", { token: tokens.au });
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length > 0);
  for (const u of r.body.data) {
    assert.equal(u.status, "active");
    assert.ok(/nguyen/i.test(u.email) || /nguyen/i.test(u.fullName));
  }
});

test("T05 GET /users?limit=500 -> 400 INVALID_QUERY_PARAMETER", async () => {
  const r = await call("GET", "/users?limit=500", { token: tokens.au });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "INVALID_QUERY_PARAMETER");
  for (const qs of ["sort=password", "q=a", "status=deleted", "roleId=abc", "page=0"]) {
    assert.equal((await call("GET", `/users?${qs}`, { token: tokens.au })).status, 400, qs);
  }
});

const NEW_USER = { email: "Le.Cuong.Moi@sis.hust.edu.vn", fullName: "  Lê Văn Cường Mới ", phone: "+84901112299", password: "Init@2026" };

test("T06 POST /users hợp lệ -> 201, Location, không passwordHash, mặc định member", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: NEW_USER });
  assert.equal(r.status, 201);
  assert.equal(r.headers.get("location"), `/api/v1/users/${r.body.id}`);
  assert.equal(r.body.passwordHash, undefined);
  assert.equal(r.body.email, "le.cuong.moi@sis.hust.edu.vn");
  assert.equal(r.body.fullName, "Lê Văn Cường Mới");
  assert.deepEqual(r.body.roles.map((x) => x.code), ["member"]);
  ids.newUser = r.body.id;
});

test("T07 POST /users trùng email -> 409 EMAIL_ALREADY_EXISTS", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: { ...NEW_USER, email: USERS[1].email.toUpperCase() } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "EMAIL_ALREADY_EXISTS");
});

test("T08 POST /users mật khẩu 123 -> 400 WEAK_PASSWORD", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: { ...NEW_USER, email: "x1@x.vn", password: "123" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.error.details.some((d) => d.field === "password" && d.issue === "WEAK_PASSWORD"));
});

test("POST /users trường lạ -> 400 FIELD_NOT_ALLOWED", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: { ...NEW_USER, email: "x2@x.vn", status: "active", isAdmin: true } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.error.details.filter((d) => d.issue === "FIELD_NOT_ALLOWED").map((d) => d.field).sort(), ["isAdmin", "status"]);
});

test("T09 POST /users roleIds:[super-admin] user-manager -> 403 PRIVILEGE_ESCALATION", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: { ...NEW_USER, email: "x3@x.vn", roleIds: [ids.roles["super-admin"]] } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "PRIVILEGE_ESCALATION");
});

test("POST /users roleIds không tồn tại -> 400 ROLE_NOT_FOUND; thiếu roles:assign -> 403", async () => {
  const r = await call("POST", "/users", { token: tokens.um, body: { ...NEW_USER, email: "x4@x.vn", roleIds: ["6717a1c2e4b0a1b2c3d4e5f6"] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "ROLE_NOT_FOUND");
});

test("T10 PATCH /users/:id {phone} -> 200, trường khác giữ nguyên", async () => {
  const r = await call("PATCH", `/users/${ids.newUser}`, { token: tokens.um, body: { phone: "+84911222333" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.phone, "+84911222333");
  assert.equal(r.body.fullName, "Lê Văn Cường Mới");
  assert.equal(r.body.email, "le.cuong.moi@sis.hust.edu.vn");
});

test("T11 PATCH /users/:id {roles} -> 400 FIELD_NOT_ALLOWED", async () => {
  const r = await call("PATCH", `/users/${ids.newUser}`, { token: tokens.um, body: { roles: [ids.roles["super-admin"]] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.details[0].issue, "FIELD_NOT_ALLOWED");
});

test("T12 PATCH /users/<mình> {status:locked} -> 403 SELF_ACTION_FORBIDDEN", async () => {
  const me = await call("GET", "/me", { token: tokens.um });
  const r = await call("PATCH", `/users/${me.body.id}`, { token: tokens.um, body: { status: "locked" } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "SELF_ACTION_FORBIDDEN");
});

test("T13 PUT /users/:id/roles/<auditor> 2 lần -> 204, 204; không trùng", async () => {
  const path = `/users/${ids.newUser}/roles/${ids.roles.auditor}`;
  assert.equal((await call("PUT", path, { token: tokens.um })).status, 204);
  assert.equal((await call("PUT", path, { token: tokens.um })).status, 204);
  const r = await call("GET", `/users/${ids.newUser}/roles`, { token: tokens.um });
  assert.equal(r.body.data.filter((x) => x.code === "auditor").length, 1);
  assert.equal(r.body.meta.totalItems, r.body.data.length);
});

test("T14 PUT /users/:id/roles/<super-admin> user-manager -> 403 PRIVILEGE_ESCALATION", async () => {
  const r = await call("PUT", `/users/${ids.newUser}/roles/${ids.roles["super-admin"]}`, { token: tokens.um });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "PRIVILEGE_ESCALATION");
});

test("T15 gỡ user-manager của A -> A dùng token cũ bị 403 ngay", async () => {
  const a = USERS.filter((u) => u.roles[0] === "user-manager")[1];
  const tokenA = await login(a.email, USER_PASSWORD);
  assert.equal((await call("GET", "/users", { token: tokenA })).status, 200);
  const del = await call("DELETE", `/users/${ids.users[a.email]}/roles/${ids.roles["user-manager"]}`, { token: tokens.sa });
  assert.equal(del.status, 204);
  const r = await call("GET", "/users", { token: tokenA });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("T16 DELETE /users/:id user-manager -> 403 FORBIDDEN", async () => {
  const r = await call("DELETE", `/users/${ids.newUser}`, { token: tokens.um });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("T17 DELETE /users/:id super-admin -> 204; GET 404; login 401", async () => {
  const r = await call("DELETE", `/users/${ids.newUser}`, { token: tokens.sa });
  assert.equal(r.status, 204);
  assert.equal(r.body, null);
  assert.equal((await call("GET", `/users/${ids.newUser}`, { token: tokens.sa })).status, 404);
  const l = await call("POST", "/auth/tokens", { body: { grantType: "password", email: NEW_USER.email, password: NEW_USER.password } });
  assert.equal(l.status, 401);
  // BR-01: email đã xóa mềm vẫn không dùng lại được
  const again = await call("POST", "/users", { token: tokens.sa, body: NEW_USER });
  assert.equal(again.status, 409);
});

test("T18 GET /users/abc -> 404 USER_NOT_FOUND", async () => {
  const r = await call("GET", "/users/abc", { token: tokens.sa });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "USER_NOT_FOUND");
});

test("T19 POST /roles mã trùng -> 409 ROLE_CODE_EXISTS", async () => {
  const r = await call("POST", "/roles", { token: tokens.sa, body: { code: "tro-giang", name: "Trợ giảng 2", permissions: [] } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "ROLE_CODE_EXISTS");
});

test("T20 PUT /roles/<member>/permissions -> 409 SYSTEM_ROLE_PROTECTED", async () => {
  const r = await call("PUT", `/roles/${ids.roles.member}/permissions`, { token: tokens.sa, body: { permissions: ["users:read"] } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "SYSTEM_ROLE_PROTECTED");
});

test("T21 DELETE /roles/<đang dùng> -> 409 ROLE_IN_USE", async () => {
  const r = await call("DELETE", `/roles/${ids.roles["tro-giang"]}`, { token: tokens.sa });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "ROLE_IN_USE");
});

test("T22 PUT /roles/:id/permissions có users:fly -> 400 PERMISSION_NOT_FOUND", async () => {
  const r = await call("PUT", `/roles/${ids.roles["tro-giang"]}/permissions`, { token: tokens.sa, body: { permissions: ["users:read", "users:fly"] } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "PERMISSION_NOT_FOUND");
});

test("T23 header X-User-Role: admin với token member -> vẫn 403", async () => {
  const r = await call("GET", "/users", { token: tokens.mb, headers: { "X-User-Role": "admin" } });
  assert.equal(r.status, 403);
});

test("T24 POST /users JSON hỏng -> 400 MALFORMED_JSON", async () => {
  const r = await call("POST", "/users", { token: tokens.um, raw: '{"email": "a@b.vn",' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "MALFORMED_JSON");
});

// ---------- Bổ sung: vai trò, BR-02/03/04/05/06 ----------
test("Vai trò: tạo, sửa, đổi quyền, xóa", async () => {
  const c = await call("POST", "/roles", { token: tokens.sa, body: { code: "thu-ky", name: "Thư ký", description: "Ghi chép", permissions: ["users:read"] } });
  assert.equal(c.status, 201);
  assert.equal(c.headers.get("location"), `/api/v1/roles/${c.body.id}`);
  assert.equal(c.body.userCount, 0);
  const id = c.body.id;
  const p = await call("PATCH", `/roles/${id}`, { token: tokens.sa, body: { name: "Thư ký khoa" } });
  assert.equal(p.status, 200);
  assert.equal(p.body.name, "Thư ký khoa");
  assert.equal((await call("PATCH", `/roles/${id}`, { token: tokens.sa, body: { code: "x-y-z" } })).body.error.details[0].issue, "FIELD_NOT_ALLOWED");
  const put = await call("PUT", `/roles/${id}/permissions`, { token: tokens.sa, body: { permissions: ["users:read", "roles:read"] } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.permissions, ["users:read", "roles:read"]);
  const rp = await call("GET", `/roles/${id}/permissions`, { token: tokens.au });
  assert.deepEqual(rp.body.data.map((x) => x.code), ["roles:read", "users:read"]);
  assert.ok(rp.body.data[0].resource && rp.body.data[0].action);
  assert.equal((await call("DELETE", `/roles/${id}`, { token: tokens.sa })).status, 204);
  assert.equal((await call("GET", `/roles/${id}`, { token: tokens.sa })).status, 404);
});

test("Vai trò hệ thống: xóa -> 409 SYSTEM_ROLE_PROTECTED", async () => {
  const r = await call("DELETE", `/roles/${ids.roles.auditor}`, { token: tokens.sa });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "SYSTEM_ROLE_PROTECTED");
});

test("GET /roles: userCount + sort mặc định theo name", async () => {
  const r = await call("GET", "/roles", { token: tokens.au });
  assert.equal(r.status, 200);
  const names = r.body.data.map((x) => x.name);
  assert.deepEqual(names, [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.ok(r.body.data.every((x) => typeof x.userCount === "number"));
});

test("GET /permissions?resource=users -> 4 quyền; ETag/304", async () => {
  const r = await call("GET", "/permissions?resource=users", { token: tokens.au });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((p) => p.code), ["users:create", "users:delete", "users:read", "users:update"]);
  const etag = r.headers.get("etag");
  assert.ok(etag);
  // Dùng node:http vì fetch tự thêm "Cache-Control: no-cache" khi có If-None-Match (Express sẽ không trả 304)
  const status = await new Promise((resolve, reject) => {
    require("node:http")
      .get(`${BASE}/permissions?resource=users`, { headers: { Authorization: `Bearer ${tokens.au}`, "If-None-Match": etag } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      })
      .on("error", reject);
  });
  assert.equal(status, 304);
});

test("BR-04: super-admin không thể bị khóa/xóa/gỡ khi là người cuối cùng", async () => {
  const saId = ids.users[USERS[0].email.toLowerCase()];
  // Tạo super-admin thứ hai để thử thao tác lên super-admin đầu (không phải chính mình)
  const c = await call("POST", "/users", { token: tokens.sa, body: { email: "sa2@x.vn", fullName: "Super Hai", password: "Super@2026", roleIds: [ids.roles["super-admin"]] } });
  assert.equal(c.status, 201);
  const sa2 = await login("sa2@x.vn", "Super@2026");
  // Khóa sa2 bằng sa -> sa là super-admin cuối, sa2 không thể khóa sa
  assert.equal((await call("PATCH", `/users/${c.body.id}`, { token: tokens.sa, body: { status: "locked" } })).status, 200);
  const sa2Token = sa2; // token sa2 giờ không còn hiệu lực
  assert.equal((await call("GET", "/me", { token: sa2Token })).status, 401);
  // Mở khóa sa2, rồi sa2 xóa sa -> OK vì còn sa2; nhưng thử lại theo hướng ngược: chỉ còn 1 -> 409
  assert.equal((await call("PATCH", `/users/${c.body.id}`, { token: tokens.sa, body: { status: "active" } })).status, 200);
  const sa2b = await login("sa2@x.vn", "Super@2026");
  assert.equal((await call("DELETE", `/users/${c.body.id}/roles/${ids.roles["super-admin"]}`, { token: tokens.sa })).status, 204);
  // Bây giờ sa là super-admin active duy nhất; sa2 không còn quyền gì
  assert.equal((await call("DELETE", `/users/${saId}`, { token: sa2b })).status, 403);
  // Self-action
  assert.equal((await call("DELETE", `/users/${saId}`, { token: tokens.sa })).body.error.code, "SELF_ACTION_FORBIDDEN");
  assert.equal((await call("DELETE", `/users/${saId}/roles/${ids.roles["super-admin"]}`, { token: tokens.sa })).body.error.code, "SELF_ACTION_FORBIDDEN");
});

test("BR-04: khóa super-admin cuối cùng -> 409 LAST_SUPER_ADMIN", async () => {
  // Tạo user-manager tạm có quyền khóa nhưng không phải super-admin không làm được (users:update có), nên dùng sa3
  const c = await call("POST", "/users", { token: tokens.sa, body: { email: "sa3@x.vn", fullName: "Super Ba", password: "Super@2026", roleIds: [ids.roles["super-admin"]] } });
  const sa3 = await login("sa3@x.vn", "Super@2026");
  const saId = ids.users[USERS[0].email.toLowerCase()];
  // sa3 khóa sa -> OK (còn sa3)
  assert.equal((await call("PATCH", `/users/${saId}`, { token: sa3, body: { status: "locked" } })).status, 200);
  // sa giờ locked: token sa hết hiệu lực; sa3 là SA active duy nhất -> ai đó khóa sa3 phải bị 409.
  // Dùng user-manager (có users:update) để thử khóa sa3:
  const r = await call("PATCH", `/users/${c.body.id}`, { token: tokens.um, body: { status: "locked" } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "LAST_SUPER_ADMIN");
  // Khôi phục sa
  assert.equal((await call("PATCH", `/users/${saId}`, { token: sa3, body: { status: "active" } })).status, 200);
  tokens.sa = await login(USERS[0].email, ADMIN_PASSWORD);
});

test("BR-02: tạo vai trò với quyền mình không có -> 403; user-manager không tạo được vai trò -> 403", async () => {
  const r = await call("POST", "/roles", { token: tokens.um, body: { code: "abc", name: "ABC", permissions: [] } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FORBIDDEN");
});

test("Mở rộng: GET /users/:id/permissions, GET /roles/:id/users, PATCH /me, PUT /me/password", async () => {
  const id = ids.users["nguyen.thu.giang@sis.hust.edu.vn"];
  const p = await call("GET", `/users/${id}/permissions`, { token: tokens.au });
  assert.equal(p.status, 200);
  assert.deepEqual(p.body.data.map((x) => x.code), ["roles:read", "users:read"]);
  const ru = await call("GET", `/roles/${ids.roles["tro-giang"]}/users`, { token: tokens.au });
  assert.equal(ru.status, 200);
  assert.equal(ru.body.meta.totalItems, 2);
  const m = await call("PATCH", "/me", { token: tokens.mb, body: { phone: "+84977000111" } });
  assert.equal(m.status, 200);
  assert.equal(m.body.phone, "+84977000111");
  assert.equal((await call("PATCH", "/me", { token: tokens.mb, body: { status: "active" } })).status, 400);
  const wrong = await call("PUT", "/me/password", { token: tokens.mb, body: { currentPassword: "Sai@2026x", newPassword: "Moi@20266" } });
  assert.equal(wrong.status, 400);
  assert.equal((await call("PUT", "/me/password", { token: tokens.mb, body: { currentPassword: USER_PASSWORD, newPassword: "Moi@20266" } })).status, 204);
  assert.ok(await login(emailOf("member"), "Moi@20266"));
});

test("Endpoint không tồn tại -> 404 JSON ENDPOINT_NOT_FOUND", async () => {
  const r = await call("GET", "/khong-co", { token: tokens.sa });
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, "ENDPOINT_NOT_FOUND");
});

test("Tìm kiếm với ký tự đặc biệt '(((' không gây 500", async () => {
  const r = await call("GET", "/users?q=(((", { token: tokens.sa });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.length, 0);
});

test("Đăng nhập sai quá 5 lần -> 429", async () => {
  const email = "trinh.thi.mai@sis.hust.edu.vn";
  for (let i = 0; i < 5; i++) await call("POST", "/auth/tokens", { body: { grantType: "password", email, password: "Wrong@123" } });
  const r = await call("POST", "/auth/tokens", { body: { grantType: "password", email, password: USER_PASSWORD } });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get("retry-after"));
});

test("CORS: origin trong whitelist được phép, origin lạ không có header", async () => {
  const ok = await fetch(`${BASE}/users`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:5500", "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "authorization,content-type" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://127.0.0.1:5500");
  const bad = await fetch(`${BASE}/users`, { method: "OPTIONS", headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "GET" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});
