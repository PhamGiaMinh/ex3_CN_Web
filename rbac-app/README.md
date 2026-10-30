# Ex3 — Fullstack RBAC · Phạm Gia Minh (20242259M)

Quản lý người dùng & phân quyền theo vai trò.
Backend: Node.js + Express 5 + MongoDB (Mongoose) + JWT · Frontend: React 18 (CDN) + Axios, 1 file `frontend/index.html`.

```
rbac-app/
├── docker-compose.yml        MongoDB 7 local
├── backend/                  API http://localhost:3001/api/v1
│   ├── server.js  seed.js  .env.example
│   ├── models/  middleware/  routes/  utils/
│   └── tests/api.test.js     42 test tích hợp (T01–T24 + bổ sung)
├── frontend/index.html
└── postman/RBAC-T01-T24.postman_collection.json
```

## Chạy

```bash
# 1. MongoDB (hoặc dùng Atlas: đặt MONGODB_URI trong .env)
cd rbac-app && docker compose up -d

# 2. Cài package
cd backend
npm install
#   máy không có npm thì cài qua Docker:
#   docker run --rm -u $(id -u):$(id -g) -e npm_config_cache=/tmp/.npm -v "$PWD":/app -w /app node:20-alpine npm install

# 3. Cấu hình: copy .env.example -> .env, điền
#    MONGODB_URI=mongodb://127.0.0.1:27017/it4409_rbac
#    JWT_SECRET=<chuỗi ngẫu nhiên dài>

# 4. Seed (xóa & tạo lại 3 collection) rồi chạy server
node seed.js
node server.js
```

Frontend — chọn một trong hai:
- Mở **http://localhost:3001/** (backend phục vụ luôn thư mục `frontend/`), hoặc
- Mở `frontend/index.html` bằng VS Code **Live Server** (`http://127.0.0.1:5500`). Không mở bằng `file://`.

## Tài khoản mẫu

| Email | Mật khẩu | Vai trò |
|---|---|---|
| 20242259M@sis.hust.edu.vn | `Admin@2026` | super-admin |
| nguyen.van.an@sis.hust.edu.vn | `User@2026` | user-manager |
| tran.thi.binh@sis.hust.edu.vn | `User@2026` | auditor |
| vu.thi.ha@sis.hust.edu.vn | `User@2026` | tro-giang (vai trò tự tạo) |
| le.van.cuong@sis.hust.edu.vn | `User@2026` | member |
| ngo.van.long@sis.hust.edu.vn | `User@2026` | member — **bị khóa** |

Các thành viên nhóm / bạn ngồi cạnh trong `seed.js` là **dữ liệu mẫu** — thay bằng tên, email thật trước khi nộp.

## Kiểm thử

```bash
cd backend
npm test        # node --test tests/ — dùng DB riêng <db>_test, tự seed & dọn, không ảnh hưởng dữ liệu dev
```

Postman: import `postman/RBAC-T01-T24.postman_collection.json` → chạy **Collection Runner** theo thứ tự
(thư mục "0. Setup" đăng nhập 4 vai trò và lấy id tự động). Nên `node seed.js` trước khi chạy.
Chạy bằng Newman qua Docker:

```bash
docker run --rm --network host -v "$PWD/postman":/etc/newman postman/newman:6-alpine run RBAC-T01-T24.postman_collection.json
```

## API

Base URL `http://localhost:3001/api/v1`.

| Method | URI | Permission |
|---|---|---|
| POST | /auth/tokens | công khai |
| GET | /me | đăng nhập |
| GET · POST | /users | users:read · users:create |
| GET · PATCH · DELETE | /users/:userId | users:read · users:update · users:delete |
| GET | /users/:userId/roles | users:read |
| PUT · DELETE | /users/:userId/roles/:roleId | roles:assign |
| GET · POST | /roles | roles:read · roles:create |
| GET · PATCH · DELETE | /roles/:roleId | roles:read · roles:update · roles:delete |
| GET · PUT | /roles/:roleId/permissions | roles:read · roles:update |
| GET | /permissions | permissions:read |

**Mở rộng đã làm:** giới hạn đăng nhập sai (5 lần/15 phút → `429 TOO_MANY_LOGIN_ATTEMPTS`, header `Retry-After`) ·
`PATCH /me` (fullName, phone) · `PUT /me/password` (`currentPassword`, `newPassword` → 204) ·
`GET /users/:userId/permissions` (quyền hiệu lực + vai trò nguồn) · `GET /roles/:roleId/users` (cần roles:read + users:read) ·
ETag / `304 Not Modified` cho `GET /permissions`.
