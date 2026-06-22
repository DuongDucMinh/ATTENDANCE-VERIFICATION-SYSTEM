# ⚡ Hệ Thống Điểm Danh Sinh Viên Bằng Khuôn Mặt (Edge-AI Face Attendance)

Hệ thống điểm danh sinh viên bằng khuôn mặt thông minh, tích hợp công nghệ trí tuệ nhân tạo biên (**Edge-AI**) và xác thực chống giả mạo (**Liveness Detection**) thời gian thực. Dự án được phát triển theo mô hình Client-Server tối ưu hiệu năng: tính toán hình học liveness trực tiếp trên trình duyệt (Edge) và nhận diện thực thể khuôn mặt (Face Recognition) tại máy chủ trung tâm.

---

## 🚀 Tính năng nổi bật

1. **Xác thực chống giả mạo phía Client (Edge-AI Liveness)**:
   - Sử dụng thư viện **MediaPipe FaceMesh** biên dịch WASM chạy trực tiếp trên trình duyệt để trích xuất 468 điểm mốc (landmarks) khuôn mặt.
   - Chuỗi thử thách ngẫu nhiên 2 bước (Chớp mắt, quay trái, quay phải, há miệng) nhằm ngăn chặn các hành vi gian lận bằng ảnh chụp, video hoặc mặt nạ.
   - Cơ chế tự động chấm điểm chất lượng ảnh (độ mờ, độ sáng) và chọn khung hình tối ưu trước khi gửi về Server.

2. **Thuật toán nhận dạng nâng cao (Hybrid Face Similarity)**:
   - Sử dụng mô hình học sâu **InsightFace** (buffalo_s) chạy trên môi trường **ONNX Runtime** để trích xuất và so khớp đặc trưng vector khuôn mặt (512 chiều).
   - Áp dụng công thức so khớp hỗn hợp (Hybrid Similarity) kết hợp điểm so khớp của góc ảnh thẳng (`front`), góc nghiêng (`left`, `right`) và vector trọng tâm (`centroid`) để tối đa hóa độ chính xác.

3. **Trải nghiệm UX/UI và Tương thích Di động (Mobile Audio Autoplay)**:
   - Giao diện và giọng nói điều hướng 100% Tiếng Việt có dấu, giúp sinh viên dễ dàng làm theo các thao tác.
   - Xử lý thông minh chính sách bảo mật Audio Autoplay của iOS/Android bằng kỹ thuật Unlock Audio qua tương tác người dùng (`unlockAndPreloadAudio`), đảm bảo âm thanh phát mượt mà, không bị chồng chéo.

4. **Tối ưu hóa hiệu năng & Băng thông**:
   - **Tải trước tài nguyên (Preload & Warmup)**: Khởi tạo sớm (warm up) đối tượng MediaPipe FaceMesh ngầm thông qua CDN ngay khi tải trang, giúp xóa bỏ hoàn toàn độ trễ 3-5 giây chờ tải mô hình khi người dùng mở camera điểm danh.
   - **FastAPI Thread-Pool Offloading**: Giải phóng Event Loop chính của FastAPI bằng cách phân phối các tác vụ chặn luồng (đọc/ghi ổ đĩa, truy vấn cơ sở dữ liệu) sang Thread Pool.
   - **ONNX Warmup**: Thực hiện suy luận giả lập ngay khi khởi động máy chủ (FastAPI lifespan) nhằm loại bỏ độ trễ dịch đồ thị lần đầu (cold start).
   - **Nginx Cache Offloading**: Sử dụng Nginx làm Reverse Proxy để phục vụ và cache tối đa các tệp âm thanh tĩnh của Frontend, giảm tải hoàn toàn cho backend Python.

---

## 🛠️ Công nghệ sử dụng

* **Frontend**: React (Vite), MediaPipe FaceMesh (WASM), Vanilla CSS.
* **Backend**: FastAPI, SQLAlchemy, Uvicorn.
* **AI Engine**: ONNX Runtime, InsightFace.
* **Cơ sở dữ liệu**: PostgreSQL với tiện ích mở rộng `pgvector` (hỗ trợ lưu trữ và so khớp vector đặc trưng 512 chiều ở cấp độ DB).
* **Triển khai**: Docker Compose, Nginx.

---

## 🗺️ Luồng nghiệp vụ chính

### 1. Đăng ký khuôn mặt (Face Registration)
Sinh viên cần đăng ký đủ 3 góc mặt mẫu để làm căn cứ xác thực:
```mermaid
flowchart TD
    A["Bắt đầu đăng ký"] --> B["Giữ mặt thẳng + Chớp mắt 1 lần"]
    B --> C["Lưu mẫu thẳng (front)"]
    C --> D["Quay mặt sang trái nhẹ"]
    D --> E["Lưu mẫu trái (left)"]
    E --> F["Quay mặt sang phải nhẹ"]
    F --> G["Lưu mẫu phải (right)"]
    G --> H["Hoàn tất đăng ký"]
```

### 2. Điểm danh xác thực (Attendance Verification)
Thực hiện chuỗi liveness ngẫu nhiên trước khi thực hiện nhận diện:
```mermaid
flowchart TD
    A["Bắt đầu điểm danh"] --> B["Căn chỉnh khuôn mặt vào khung hình"]
    B --> C["Thử thách liveness ngẫu nhiên 2 bước"]
    C --> D["Vượt qua thử thách"]
    D --> E["Quay về góc mặt thẳng (nhìn thẳng camera)"]
    E --> F["Chụp loạt ảnh thẳng tốt nhất (Neutral Capture)"]
    F --> G["Backend tính điểm Hybrid Similarity"]
    G --> H{"Điểm số >= Ngưỡng?"}
    H -- "Có" --> I["Điểm danh THÀNH CÔNG"]
    H -- "Không" --> J["Điểm danh THẤT BẠI"]
```

---

## 💻 Hướng dẫn chạy local

### 1. Khởi động Cơ sở dữ liệu (PostgreSQL + pgvector)
Dự án được cấu hình mặc định sử dụng PostgreSQL. Bạn có thể khởi chạy nhanh container DB bằng Docker Compose:
```bash
docker compose up -d
```

### 2. Cấu hình & Chạy Backend
* Tạo môi trường ảo và cài đặt thư viện:
  ```bash
  python -m venv .venv
  # Windows
  .\.venv\Scripts\activate
  # Linux/macOS
  source .venv/bin/activate
  
  pip install -r requirements.txt
  ```
* Tạo tệp cấu hình `.env` ở thư mục gốc của dự án (sử dụng các cấu hình từ tệp mẫu `.env.example`):
  ```env
  DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/attendance_verification
  SIMILARITY_THRESHOLD=0.7
  UPLOADS_DIR=backend/data/face_images
  ```
* Khởi chạy FastAPI Backend:
  ```bash
  python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
  ```

### 3. Cài đặt & Chạy Frontend
* Di chuyển vào thư mục `frontend` và cài đặt các gói NPM:
  ```bash
  cd frontend
  npm install
  ```
* Khởi chạy Vite Dev Server:
  ```bash
  npm run dev
  ```
* Mở trình duyệt truy cập: `http://localhost:5173`. Vite sẽ tự động proxy các request có đường dẫn `/api/*` sang máy chủ backend đang chạy ở port `8000`.

---

## 🧪 Kiểm thử (Testing)

### 1. Kiểm thử Frontend (Unit tests bằng Vitest)
```bash
cd frontend
npm run test
```

### 2. Kiểm thử Backend (Unit tests bằng Python unittest)
```bash
python -m unittest tests/test_main.py
```

---

## 🌐 Triển khai Production (Nginx Proxy)

Để hệ thống hoạt động ổn định khi phục vụ số lượng lớn sinh viên truy cập đồng thời (100+ người), bạn nên triển khai **Nginx** làm Reverse Proxy đứng trước FastAPI để phục vụ tài nguyên tĩnh (như các file âm thanh Tiếng Việt).

Tệp cấu hình mẫu chi tiết được lưu trữ tại [nginx.conf](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/nginx.conf). Nginx sẽ cấu hình cache tối đa cho tệp tĩnh:
```nginx
location /audio/ {
    alias /path/to/project/frontend/public/audio/;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
    access_log off;
}
```

---

## 📝 Tài liệu bổ sung
* **Báo cáo kỹ thuật chi tiết**: [REPORT_VI.md](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/REPORT_VI.md) - Chứa thông tin chi tiết về giải thuật hình học, công thức toán học, cấu hình tham số threshold và phân tích chuyên sâu các điểm nghẽn hiệu năng.
