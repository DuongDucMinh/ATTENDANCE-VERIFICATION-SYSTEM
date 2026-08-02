FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV INSIGHTFACE_ROOT=/app/models

WORKDIR /app

# Cài đặt thư viện hệ thống cần thiết cho các thư viện C++ (như numpy/insightface)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt dependencies Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Sao chép mã nguồn backend vào thư mục làm việc
COPY backend /app/backend

EXPOSE 8000

# Khởi chạy ứng dụng FastAPI bằng uvicorn
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
