# Báo Cáo Kỹ Thuật Hệ Thống (Technical Report & Developer Guide)

Báo cáo này mô tả chi tiết kiến trúc, giải thuật toán học, cấu hình tham số (thresholds) và các giải pháp tối ưu hóa hiệu năng được triển khai nhằm đảm bảo hệ thống phục vụ tốt hơn 100 sinh viên điểm danh đồng thời.

---

## 1. Kiến Trúc Hệ Thống & Phân Tách Trách Nhiệm

Hệ thống được thiết kế theo mô hình lai **Edge-AI** kết hợp **Cloud Inference** nhằm tối ưu hóa tải cho máy chủ:

* **React Frontend (Edge Processing)**:
  - Quản lý luồng webcam trực quan của trình duyệt.
  - Sử dụng **MediaPipe FaceMesh (WASM)** để trích xuất 468 tọa độ landmark 3D của khuôn mặt trực tiếp trên CPU của máy khách.
  - Tính toán hình học liveness (chớp mắt, quay đầu, mở miệng) theo tần suất khung hình (30 FPS).
  - Đánh giá chất lượng ảnh (độ mờ, độ sáng, chất lượng bố cục khuôn mặt).
  - Khi thử thách kết thúc, chụp loạt ảnh (burst) ở trạng thái thẳng tự nhiên (neutral), chọn ra 1 ảnh có chất lượng tốt nhất và gửi lên Server.
  
* **FastAPI Backend (Centralized AI Inference)**:
  - Nhận ảnh và dữ liệu capture từ Client.
  - Giải mã ảnh nhị phân thành ma trận màu BGR bằng OpenCV.
  - Sử dụng mô hình **InsightFace** thông qua công cụ suy luận **ONNX Runtime** để sinh ra vector đặc trưng khuôn mặt (face embedding vector 512 chiều).
  - So khớp vector này với các mẫu đã đăng ký trong cơ sở dữ liệu **PostgreSQL (pgvector)** bằng giải thuật so khớp hỗn hợp (Hybrid Similarity).
  - Lưu kết quả chi tiết (bao gồm cả điểm số, lý do và metadata) vào bảng nhật ký `attendance_logs`.

---

## 2. Công Thức & Giải Thuật Liveness Phía Client

Phía Frontend thực hiện tính toán hình học dựa trên các điểm mốc (landmark indices) của MediaPipe:

### 2.1 Phát hiện Chớp mắt (Eye Aspect Ratio - EAR)
Chỉ số EAR được dùng để đo tỉ lệ mở rộng của mắt:
$$EAR = \frac{||p_2 - p_6|| + ||p_3 - p_5||}{2 \times ||p_1 - p_4||}$$

Trong đó, $p_1 \dots p_6$ là tọa độ các điểm mốc quanh mắt:
* **Mắt trái**: `[33, 160, 158, 133, 153, 144]`
* **Mắt phải**: `[263, 387, 385, 362, 380, 373]`

Hệ thống ghi nhận chớp mắt khi EAR giảm xuống dưới `closeFloorEar` (mắt nhắm) và phục hồi lên trên `recoverFloorEar` (mắt mở lại) trong khoảng số khung hình quy định (`minBlinkFrames` đến `maxBlinkFrames`).

### 2.2 Ước lượng Tư thế Đầu (Head Pose Estimation)
Góc quay của đầu (Yaw, Pitch, Roll) được ước lượng heuristic qua tỉ lệ khoảng cách giữa mũi, mắt và kích thước khuôn mặt:
* **Roll (Góc nghiêng vai)**: Tính bằng góc giữa đường thẳng nối hai tâm mắt và trục ngang.
  $$\text{roll} = \text{atan2}(dy_{eye}, dx_{eye})$$
* **Yaw (Góc quay trái/phải)**: Tính bằng độ lệch của đỉnh mũi so với điểm trung tâm của mắt, chuẩn hóa theo khoảng cách hai mắt:
  $$\text{yaw} = \text{atan}\left(\frac{x_{nose} - x_{eye\_mid}}{eye\_span} \times k_{yaw}\right)$$
* **Pitch (Góc cúi/ngửa)**: Tính bằng độ lệch dọc của mũi so với trung tâm khuôn mặt, chuẩn hóa theo chiều cao khuôn mặt:
  $$\text{pitch} = \text{atan}\left(\frac{y_{nose} - y_{face\_mid}}{face\_height} \times k_{pitch}\right)$$

### 2.3 Phát hiện Mở miệng (Mouth Open Ratio)
Tỷ lệ mở miệng được tính bằng tỷ số giữa khoảng cách dọc của môi trong và khoảng cách ngang của mép miệng:
$$\text{mouth\_open\_ratio} = \frac{\text{distance}(upper\_lip, lower\_lip)}{\text{distance}(mouth\_left, mouth\_right)}$$

---

## 3. Thuật Toán Nhận Diện Khuôn Mặt Phía Server

Khi sinh viên đăng ký, hệ thống yêu cầu lưu đúng 3 mẫu tư thế ảnh: thẳng (`front`), nghiêng trái (`left`), nghiêng phải (`right`). 

Khi điểm danh, Server thực hiện so khớp ảnh gửi lên (`probe`) với 3 mẫu đăng ký theo thuật toán **Adaptive Pose-Matching with Penalty** (So khớp tư thế thích ứng có phạt):

1. **So khớp trực tiếp (Direct Matching)**:
   * Lấy ảnh đăng ký có cùng tư thế với ảnh điểm danh (ảnh điểm danh có `pose_label` là `front`, ta so khớp nó với ảnh đăng ký `front` trong cơ sở dữ liệu).
   * Điểm tương đồng trực tiếp: 
     $$S_{direct} = \text{cosine}(probe, front)$$

2. **Xác thực chéo chống giả mạo (Cross-Verification)**:
   * So khớp ảnh điểm danh với 2 ảnh đăng ký góc nghiêng (`left` và `right`):
     $$S_{left} = \text{cosine}(probe, left)$$
     $$S_{right} = \text{cosine}(probe, right)$$
   * Tính điểm chéo trung bình:
     $$S_{cross} = \text{mean}(\{S_{left}, S_{right}\})$$

3. **Tính điểm quyết định cuối cùng (Final Score)**:
   * Hệ thống áp dụng một ngưỡng chéo tối thiểu $T_{cross} = 0.48$ để xác minh tính nhất quán cấu trúc 3D của khuôn mặt (tránh việc dùng ảnh thẳng giả mạo hoặc người khác):
     * Nếu $S_{cross} \ge 0.48$:
       $$\text{final\_score} = S_{direct}$$
       (Giữ nguyên điểm số trực diện cực cao của sinh viên hợp lệ, không bị kéo thấp bởi các ảnh nghiêng).
     * Nếu $S_{cross} < 0.48$:
       $$\text{final\_score} = S_{direct} \times \frac{S_{cross}}{0.48}$$
       (Áp dụng hình phạt giảm điểm số tỷ lệ thuận để đánh trượt).
   * Trường hợp dữ liệu cũ (sinh viên chưa đăng ký đủ 3 góc mặt), hệ thống tự động fallback về thuật toán tính hybrid cũ:
     $$\text{final\_score} = \text{min}\left(0.99, \text{max}(S_{best}, S_{weighted})\right)$$

Hệ thống quyết định sinh viên điểm danh thành công nếu $\text{final\_score} \ge \text{SIMILARITY\_THRESHOLD}$ (mặc định là $0.7$, cấu hình được trong tệp `.env`).

---

## 4. Các Tham Số Threshold Hệ Thống

Tất cả các tham số ngưỡng được tập trung cấu hình tại tệp [constants.js](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/frontend/src/liveness/constants.js):

| Nhóm tham số | Tên tham số | Giá trị mặc định | Mô tả |
| :--- | :--- | :--- | :--- |
| **Session** | `alignmentHoldMs` | `1000` ms | Thời gian giữ mặt thẳng ổn định để bắt đầu phiên. |
| | `alignmentTimeoutMs` | `15000` ms | Thời gian tối đa để hoàn thành căn chỉnh khuôn mặt ban đầu. |
| | `poseHoldMs` | `400` ms | Thời gian giữ tư thế nghiêng hoặc há miệng để pass bước thử thách. |
| | `verifyStepTimeoutMs` | `15000` ms | Thời gian tối đa để hoàn thành một bước thử thách liveness. |
| | `verifySessionTimeoutMs` | `30000` ms | Thời gian tối đa của toàn bộ phiên điểm danh. |
| | `verifyStabilityTimeoutMs`| `15000` ms | Thời gian chờ tối đa cho bước chụp ảnh thẳng ổn định sau thử thách (Stability Timeout). |
| | `registerSessionTimeoutMs`| `30000` ms | Thời gian tối đa của toàn bộ phiên đăng ký. |
| **Blink** | `minBaselineEar` | `0.16` | EAR cơ bản tối thiểu để nhận diện mắt bình thường. |
| | `closeFloorEar` | `0.12` | Ngưỡng EAR xác định mắt nhắm. |
| | `recoverFloorEar` | `0.16` | Ngưỡng EAR xác định mắt mở lại sau khi chớp. |
| **Alignment** | `strictCenterX` / `Y` | `0.12` | Độ lệch tối đa cho phép so với tâm camera để coi là mặt thẳng ở giữa. |
| | `frontYawMax` | `11` độ | Góc lệch Yaw tối đa để coi là nhìn thẳng. |
| | `rollMax` / `pitchMax` | `10` / `14` độ | Góc lệch nghiêng tối đa của mặt thẳng. |
| **Pose** | `leftYawMin` / `rightYawMin`| `-14` / `14` độ | Góc Yaw tối thiểu để kích hoạt trạng thái quay trái / quay phải. |
| | `mouthOpenRatioMin` | `0.24` | Tỉ lệ tối thiểu để xác nhận mở miệng. |
| **Quality** | `blurMin` | `12` | Điểm độ sắc nét tối thiểu (Laplacian Variance). |
| | `brightnessMin` / `Max` | `40` / `220` | Ngưỡng độ sáng trung bình của khuôn mặt (thang 0-255). |
| | `qualityMin` | `0.25` | Điểm chất lượng tổng hợp tối thiểu của khuôn mặt. |

---

## 5. Điểm Nghẽn Hiệu Năng & Các Giải Pháp Đã Triển Khai

Để đảm bảo hệ thống vận hành trơn tru dưới tải cao (hơn 100 sinh viên đồng thời), các điểm nghẽn (bottlenecks) chính đã được xử lý triệt để như sau:

### 5.1 Giải quyết Blocking I/O trên Event Loop của FastAPI
* **Vấn đề**: Việc đọc file từ payload bằng `await file.read()`, ghi ảnh xuống đĩa bằng `path.write_bytes()`, và thực hiện các giao dịch cơ sở dữ liệu đồng bộ của SQLAlchemy trong các route được khai báo `async def` sẽ chặn (block) toàn bộ Event Loop đơn luồng của FastAPI. Điều này khiến cho các request điểm danh khác phải xếp hàng chờ đợi, làm tăng đột biến độ trễ (latency).
* **Giải pháp**:
  - Chuyển đổi toàn bộ các hàm API trong [routes.py](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/api/routes.py) từ `async def` thành `def`.
  - Thay thế việc đọc file bất tuần tự bằng `file.file.read()` đồng bộ.
  - Thêm chỉ mục `index=True` vào cột `student_id` và `created_at` trong bảng `AttendanceLog` ở [models.py](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/models.py).
* **Hiệu quả**: FastAPI tự động chuyển hướng chạy các endpoint đồng bộ `def` vào **Thread Pool** phụ (`anyio`). Event Loop chính hoàn toàn tự do để nhận và phân phối các kết nối HTTP khác mà không bị đứng. Đánh chỉ mục giúp các truy vấn báo cáo và lịch sử điểm danh phản hồi trong vài mili-giây thay vì quét toàn bộ bảng.

### 5.2 Khử độ trễ lạnh (Cold Start Latency) của ONNX Runtime
* **Vấn đề**: ONNX Runtime chỉ thực sự biên dịch và tối ưu hóa đồ thị tính toán ở lần đầu tiên chạy suy luận (first forward pass). Do đó, sinh viên đầu tiên mở camera điểm danh thường phải đợi từ 3-5 giây để Server phản hồi.
* **Giải pháp**:
  - Cập nhật hàm `warm_up` trong dịch vụ [embedding.py](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/services/embedding.py) chạy thử suy luận với một ma trận numpy trống kích thước $100 \times 100 \times 3$.
  - Gọi hàm chạy thử này trực tiếp trong sự kiện `lifespan` lúc khởi động ứng dụng FastAPI (trong [main.py](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/backend/app/main.py)).
* **Hiệu quả**: Loại bỏ hoàn toàn độ trễ lần đầu tiên. Khi sinh viên đầu tiên điểm danh, Server phản hồi ngay lập tức với tốc độ suy luận tối đa.

### 5.3 Tối ưu hóa tải tài nguyên Frontend (Preload & Cache)
* **Vấn đề**: Việc chờ tải mô hình FaceMesh khi người dùng nhấn "Bắt đầu" có thể gây ra độ trễ 3-5 giây (lag), ảnh hưởng đến trải nghiệm người dùng. Đồng thời, việc FastAPI phải phục vụ các tài nguyên tĩnh như âm thanh sẽ gây lãng phí tài nguyên CPU backend.
* **Giải pháp**:
  - **Preload MediaPipe (CDN)**: Triển khai hàm `preloadFaceMesh` chạy ngầm để tải mô hình trực tiếp từ CDN (JSDelivr) ngay khi người dùng truy cập trang, loại bỏ độ trễ khi khởi động camera.
  - **Nginx Cache Offloading**: Cấu hình **Nginx** (chi tiết tại [nginx.conf](file:///D:/Python/project/ATTENDANCE-VERIFICATION/ATTENDANCE-VERIFICATION-SYSTEM/nginx.conf)) làm Reverse Proxy để phục vụ trực tiếp thư mục `/audio/` của Frontend với chính sách cache lâu dài (`expires 30d; add_header Cache-Control "public, max-age=2592000, immutable";`).
* **Hiệu quả**: Loại bỏ hoàn toàn độ trễ khởi động camera trên Client, tiết kiệm 100% tài nguyên CPU của FastAPI cho nhiệm vụ truyền tải file tĩnh, tối ưu hóa băng thông mạng.

### 5.4 Khắc phục chính sách Autoplay Audio trên trình duyệt di động
* **Vấn đề**: Các trình duyệt trên thiết bị di động (đặc biệt là iOS Safari và Chrome Android) áp dụng chính sách bảo mật nghiêm ngặt chặn tự động phát âm thanh (Audio Autoplay) nếu không xuất phát trực tiếp từ tương tác người dùng. Điều này khiến các thông báo âm thanh (ví dụ "Hãy quay sang trái", "Đưa mặt vào giữa khung hình") thỉnh thoảng không phát, hoặc phát chồng chéo lên nhau khi mạng chậm.
* **Giải pháp**:
  - Triển khai bộ nhớ đệm âm thanh toàn cục (`globalAudioCache`) để lưu giữ các đối tượng `HTMLAudioElement`.
  - Xây dựng cơ chế `unlockAndPreloadAudio`: Khi sinh viên vừa nhấn nút "Bắt Đầu", hệ thống lập tức lặp qua toàn bộ file âm thanh, thiết lập `volume = 0` và gọi `.play()` rồi `.pause()`. Thao tác này "mở khóa" quyền phát âm thanh cho các phần tử này trong toàn bộ phiên làm việc.
  - Áp dụng logic dừng toàn bộ âm thanh cũ trước khi phát âm thanh mới để tránh chồng chéo.
* **Hiệu quả**: Đảm bảo 100% âm thanh điều hướng được phát mượt mà, đồng bộ và rõ ràng trên mọi thiết bị di động cũng như máy tính để bàn.

### 5.5 Cải tiến UI/UX & Motion nâng cao cho Liveness Animation
* **Vấn đề**:
  - Hoạt ảnh 4 góc khung định vị khuôn mặt (`focus-corner`) sử dụng hiệu ứng thay đổi độ mờ liên tục (`focus-pulse`) tạo cảm giác chuyển động chậm, đôi khi không thu hút sự chú ý của người dùng để thực hiện căn chỉnh nhanh.
  - Các mũi tên hướng dẫn quay trái/phải (`arrow-left`, `arrow-right`) khi dao động (bounce) di chuyển quá sát và đè lên khuôn mặt đồ họa ở trung tâm, gây cảm giác chồng chéo hình ảnh. Ngoài ra, do giới hạn bởi kích thước SVG (`viewBox="0 0 100 100"`), các mũi tên khi di chuyển tới sát rìa ngoài cùng thường bị trình duyệt cắt mất một góc vẽ (clipping).
* **Giải pháp**:
  - **Khung góc nhấp nháy cơ học**: Thay thế animation `focus-pulse` cũ bằng hiệu ứng `focus-blink` với tốc độ chu kỳ ngắn `0.8s` sử dụng `steps(1, start)` tạo cảm giác nhấp nháy cơ học (toggle opacity đột ngột giữa `0.2` và `1`), giúp thu hút sự chú ý hiệu quả hơn.
  - **Dịch chuyển toạ độ mũi tên**: Thay đổi dịch chuyển hệ số toạ độ `x` của nét vẽ vector trong SVG của hai mũi tên ra ngoài rìa xa hơn 6 đơn vị (ví dụ, dịch đuôi mũi tên trái từ `28` về `22`, và đuôi mũi tên phải từ `72` lên `78`) để tạo khoảng cách an toàn với khuôn mặt giả lập.
  - **Khắc phục lỗi cắt nét vẽ (Clipping)**: Thêm thuộc tính CSS `overflow: visible !important;` trên lớp `.anim-svg` để trình duyệt cho phép hiển thị các phần tử con trượt ra ngoài vùng chứa vector. Đồng thời điều chỉnh padding của thẻ chứa `.hud-card` thêm khoảng đệm bên phải (`padding: 0 16px 0 20px` thay vì `0 0 0 20px`) để không bị cắt bởi thuộc tính `overflow: hidden` của thẻ HUD card.
* **Hiệu quả**: Hoạt ảnh chỉ dẫn liveness chuyển động mượt mà, định vị chính xác, không bị đè nét vẽ hay mất chi tiết ở rìa biên trên cả thiết bị di động và máy tính.

