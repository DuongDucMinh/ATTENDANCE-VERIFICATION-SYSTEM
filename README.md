# Hệ Thống Điểm Danh Khuôn Mặt

Ứng dụng web điểm danh sinh viên bằng khuôn mặt, gồm frontend React và backend FastAPI. Phiên bản hiện tại tập trung vào:

- Đăng ký 3 mẫu khuôn mặt `front / left / right`
- Điểm danh bằng challenge ngẫu nhiên nhiều bước
- Chọn frame tốt nhất ở frontend
- Tính `hybrid similarity` ở backend bằng InsightFace

Báo cáo kỹ thuật chi tiết nằm tại [REPORT_VI.md](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/REPORT_VI.md).

## Luồng nghiệp vụ

### Đăng ký khuôn mặt

```mermaid
flowchart TD
    A["Bắt đầu đăng ký"] --> B["Front: mặt thẳng + chớp mắt 1 lần"]
    B --> C["Lưu mẫu front"]
    C --> D["Left: quay trái và giữ"]
    D --> E["Lưu mẫu left"]
    E --> F["Right: quay phải và giữ"]
    F --> G["Lưu mẫu right"]
```

### Điểm danh

```mermaid
flowchart TD
    A["Bắt đầu điểm danh"] --> B["Căn mặt ổn định trong khung"]
    B --> C["Challenge ngẫu nhiên 2 bước"]
    C --> D["Challenge đạt"]
    D --> E["Quay về mặt thẳng và giữ ổn định ngắn"]
    E --> F["Chọn frame neutral tốt nhất"]
    F --> G["Backend tính hybrid similarity"]
    G --> H["Trả kết quả + decision breakdown"]
```

## Cấu hình môi trường

Dự án chỉ cần một file cấu hình runtime ở root:

- [.env](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/.env)
- [.env.example](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/.env.example)

Frontend dev server không cần `frontend/.env` cho luồng local hoặc VS Code dev tunnel. Mặc định frontend gọi relative `/api`, sau đó Vite proxy request sang backend local `http://127.0.0.1:8000`.

Khi test trên điện thoại bằng VS Code forward port, chỉ cần forward port frontend `5173`. Backend vẫn chạy local ở `127.0.0.1:8000`; request `/api/...` đi qua tunnel frontend rồi được Vite proxy sang backend.

## Cấu hình threshold

### Frontend

Toàn bộ threshold phía frontend đã được gom vào một bảng cấu hình duy nhất:

- [constants.js](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/constants.js)

Cấu trúc chính:

- `THRESHOLDS.session`
- `THRESHOLDS.blink`
- `THRESHOLDS.alignment`
- `THRESHOLDS.pose`
- `THRESHOLDS.quality`
- `THRESHOLDS.antiReplay`

Ngoài ra, tham số lấy mẫu frame nằm trong:

- `FRAME_CONFIG.sampleSize`
- `FRAME_CONFIG.maxBufferedFrames`
- `FRAME_CONFIG.sampleEveryNFrames`

### Backend

Ngưỡng quyết định similarity nằm trong:

- [.env.example](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/.env.example)
- [config.py](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/config.py)

Biến đang dùng:

```env
SIMILARITY_THRESHOLD=0.7
```

## Cách cập nhật threshold

1. Nếu đổi threshold frontend, sửa [constants.js](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/constants.js).
2. Nếu đổi threshold backend runtime, sửa [.env](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/.env). File [.env.example](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/.env.example) chỉ là mẫu.
3. Sau khi sửa frontend:

```powershell
cd frontend
npm run build
```

4. Sau khi sửa backend `.env`, phải tắt process backend cũ và chạy lại từ thư mục gốc project:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

5. Kiểm tra runtime thật sự:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/health
```
6. Kiểm tra backend runtime thật sự:

- [http://127.0.0.1:8000/api/runtime-config](http://127.0.0.1:8000/api/runtime-config)
- [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

## Hybrid similarity

Backend hiện dùng công thức:

```text
centroid_score = cosine(probe, centroid)
best_sample_score = max(sample_scores)
top_k_score = mean(top 2 sample_scores)
pose_weighted_score = 0.7 * top_k_score + 0.3 * centroid_score
raw_match_score = max(best_sample_score, pose_weighted_score)
final_score = min(0.99, raw_match_score)
```

`capture_meta.quality` vẫn được backend ghi vào log để debug, nhưng không còn dùng để cộng hoặc trừ vào `final_score`.

Trong `verify`, frame gửi lên backend không lấy trực tiếp từ lúc đang thực hiện challenge. Challenge chỉ dùng để xác nhận liveness; sau khi challenge đạt, frontend sẽ lấy thêm một burst frame neutral riêng để phục vụ recognition.

Khi điểm danh, frontend cũng hiển thị:

- `Threshold backend runtime`
- `Điểm hybrid similarity`
- `Raw match score`

## API chính

- `POST /api/profile/upsert`
- `GET /api/profile/{student_id}`
- `POST /api/face/register`
- `POST /api/attendance/verify`
- `GET /api/runtime-config`
- `GET /api/health`

## Trạng thái anti-replay

Module anti-replay heuristic vẫn còn trong mã nguồn để nghiên cứu tiếp, nhưng hiện tại:

- Không dùng để fail phiên
- Không hiển thị trên giao diện debug
- Không còn giao diện legacy riêng

## Chạy local

### PostgreSQL

```powershell
docker compose up -d
```

### Backend

```powershell
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Khi mở trên điện thoại qua VS Code dev tunnel, forward port `5173` và mở URL tunnel của frontend. Không cần forward port `8000` nếu đang dùng Vite dev server.

## Kiểm thử

Frontend:

```powershell
cd frontend
npm test -- --run
npm run build
```

Backend:

```powershell
python -m unittest discover -s tests
```

## Cấu trúc đáng chú ý

- [CameraSession.jsx](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/components/CameraSession.jsx)
- [constants.js](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/constants.js)
- [challengeEngine.js](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/challengeEngine.js)
- [quality.js](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/quality.js)
- [attendance.py](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/services/attendance.py)
- [routes.py](/D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/api/routes.py)
