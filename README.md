# Hệ Thống Web Điểm Danh Khuôn Mặt

Ứng dụng web điểm danh sinh viên bằng khuôn mặt, gồm frontend React và backend FastAPI. Hệ thống tập trung vào luồng sử dụng thực tế: đăng ký khuôn mặt trong trang cá nhân, sau đó điểm danh theo `student_id` với kiểm tra liveness trước khi gửi ảnh lên server.

## 1. Tính năng chính
- Giao diện web có sidebar:
  - `Thông tin cá nhân`
  - `Điểm danh`
- Đăng ký khuôn mặt và điểm danh đều dùng webcam trực tiếp.
- Kiểm tra điều kiện trên client trước khi gửi ảnh:
  - căn giữa trong khung oval
  - kiểm tra pose (roll/yaw/pitch)
  - kiểm tra kích thước khuôn mặt trong khung
  - giữ ổn định liên tục theo thời gian
  - chớp mắt để xác thực sống
- Sau khi đủ điều kiện, hệ thống tự crop khuôn mặt và gửi API.
- Backend sinh embedding khuôn mặt bằng InsightFace (`buffalo_s`) và xác minh bằng cosine similarity.
- Lưu dữ liệu trên PostgreSQL + pgvector:
  - hồ sơ người dùng
  - embedding khuôn mặt
  - lịch sử đăng ký/điểm danh

## 2. Kiến trúc hệ thống
```text
Frontend (React + MediaPipe)
  -> webcam + face landmarks
  -> check alignment / pose / size / blink
  -> auto-crop ảnh khuôn mặt
  -> gọi API backend

Backend (FastAPI + InsightFace)
  -> decode ảnh
  -> extract embedding 512 chiều
  -> verify với embedding đã đăng ký của chính student_id
  -> ghi log kết quả vào PostgreSQL
```

## 3. Công nghệ sử dụng
- Frontend: React, Vite, JavaScript, MediaPipe Face Mesh
- Backend: FastAPI, SQLAlchemy, InsightFace, OpenCV, NumPy
- Database: PostgreSQL 16 + pgvector
- Testing: `unittest` (backend), `vitest` (frontend)

## 4. Cấu trúc thư mục
```text
backend/
  app/
    api/
    services/
    models.py
    repositories.py
    db.py
    main.py
  scripts/
    import_face_db.py
frontend/
  src/
  tests/
docker-compose.yml
setup_local.ps1
requirements.txt
```

## 5. Thiết lập môi trường
1. Cài Docker Desktop, Python 3.10+, Node.js 18+.
2. Tạo file môi trường:
```powershell
copy .env.example .env
```

`.env.example`:
```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/attendance_verification
SIMILARITY_THRESHOLD=0.80
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## 6. Chạy nhanh (Windows)
Script tự động:
```powershell
.\setup_local.ps1
```

Script sẽ:
- dựng PostgreSQL + pgvector bằng Docker
- tạo `.venv` nếu chưa có, cài dependencies backend
- cài dependencies frontend

Nếu đã cài sẵn backend/frontend và chỉ cần DB:
```powershell
.\setup_local.ps1 -SkipBackendInstall -SkipFrontendInstall
```

## 7. Chạy thủ công
### 7.1 Khởi động database
```powershell
docker compose up -d
```

### 7.2 Chạy backend
```powershell
.\.venv\Scripts\python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

### 7.3 Chạy frontend
```powershell
cd frontend
npm run dev
```

Truy cập:
- Frontend: `http://127.0.0.1:5173`
- Swagger: `http://127.0.0.1:8000/docs`

## 8. API chính
- `POST /api/profile/upsert`: tạo/cập nhật hồ sơ theo `student_id`
- `GET /api/profile/{student_id}`: lấy hồ sơ và trạng thái đăng ký khuôn mặt
- `POST /api/face/register`: đăng ký/cập nhật embedding khuôn mặt
- `POST /api/attendance/verify`: điểm danh, so khớp với embedding của chính `student_id`
- `GET /api/health`: kiểm tra trạng thái dịch vụ

## 9. Mô tả quy trình kiểm tra trên camera
Trong mỗi phiên đăng ký/điểm danh:
1. Mở camera và nhận landmarks từ MediaPipe.
2. Kiểm tra khuôn mặt nằm gần tâm khung oval.
3. Kiểm tra pose đầu (không nghiêng/quay quá mức).
4. Kiểm tra kích thước mặt phù hợp với khung mục tiêu.
5. Giữ đồng thời các điều kiện ổn định trong một khoảng thời gian.
6. Theo dõi EAR để phát hiện chớp mắt (liveness).
7. Khi đủ điều kiện, tự động crop ảnh khuôn mặt và gửi về backend.
8. Backend trả kết quả thành công/thất bại, camera dừng phiên hiện tại.

## 10. Dữ liệu lưu trữ
- **Không lưu ảnh khuôn mặt gốc trong source code**.
- Thông tin lưu trong PostgreSQL:
  - bảng `users`: hồ sơ cá nhân
  - bảng `face_embeddings`: vector khuôn mặt
  - bảng `attendance_logs`: lịch sử đăng ký/điểm danh

## 11. Kiểm thử
Backend:
```powershell
python -m unittest discover -s tests -v
```

Frontend:
```powershell
cd frontend
npm run test
```

## 12. Bảo mật và lưu ý triển khai
- `.gitignore` đã chặn:
  - `.env`, log, DB local, dữ liệu ảnh sinh trắc học
- Trước khi production:
  - đổi mật khẩu DB
  - bật HTTPS
  - thêm rate limit và theo dõi audit log
  - mã hóa backup và secrets
