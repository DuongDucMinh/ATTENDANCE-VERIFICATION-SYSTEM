FROM node:20-alpine

WORKDIR /app

# Cài đặt package dependencies
COPY package*.json ./
RUN npm install

# Sao chép mã nguồn frontend
COPY . .

EXPOSE 5173

# Khởi chạy Vite dev server (host: 0.0.0.0 đã được cấu hình trong vite.config.js)
CMD ["npm", "run", "dev"]
