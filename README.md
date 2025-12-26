# Graphwar Web - Đồ án cuối kỳ môn Phát triển ứng dụng Web

Dự án này là một bản tái hiện (re-implementation) trên nền tảng Web của trò chơi chiến thuật toán học nổi tiếng **Graphwar**. Đây là đồ án cuối kỳ cho môn học **Phát triển ứng dụng Web**.

## 📌 Nguồn gốc & Bản quyền
Dự án này được phát triển dựa trên ý tưởng và mã nguồn mở của:
- **Dự án gốc:** [Graphwar](https://github.com/catabriga/graphwar) bởi catabriga.
- **Giấy phép:** [MIT License](https://opensource.org/licenses/MIT).

Chúng tôi chân thành cảm ơn tác giả gốc đã tạo ra một trò chơi giáo dục tuyệt vời kết hợp giữa toán học và chiến thuật.

## 🚀 Tính năng nổi bật
- **Multiplayer thời gian thực:** Chơi cùng bạn bè qua trình duyệt web sử dụng WebSocket.
- **Toán học tương tác:** Sử dụng các hàm số toán học ($y = f(x)$) để điều khiển quỹ đạo đạn.
- **Hệ thống CSDL:** Lưu trữ thống kê người chơi, bảng xếp hạng và danh hiệu bằng MariaDB.
- **AI Hint:** Tích hợp Mô hình ngôn ngữ lớn (LLM) để gợi ý hàm số cho người chơi.
- **Bot (heuristic):** Hỗ trợ thêm bot để lấp phòng/chơi thử; bot chọn hàm đơn giản theo mục tiêu gần nhất.

## 🛠 Công nghệ sử dụng
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Node.js, WebSocket (`ws`), TypeScript.
- **Database:** MariaDB.
- **Shared Logic:** Thư viện dùng chung cho parser toán học và vật lý game.
- **AI:** FPT Cloud LLM API (hoặc OpenAI compatible API).

## 📂 Cấu trúc dự án (Monorepo)
- `/client`: Mã nguồn ứng dụng React chạy trên trình duyệt.
- `/server`: Server Node.js xử lý logic game và kết nối CSDL.
- `/shared`: Các kiểu dữ liệu, parser toán học và logic vật lý dùng chung cho cả client và server.
- `/latex_report`: Báo cáo tiểu luận chi tiết bằng LaTeX.

## ⚙️ Hướng dẫn cài đặt

### 1. Yêu cầu hệ thống
- Node.js 18+
- MariaDB 10.6+

### 2. Cài đặt dependencies
```bash
npm install
```

### 3. Thiết lập Cơ sở dữ liệu
Chạy script SQL để tạo database và bảng:
```powershell
# Trên Windows (PowerShell)
Get-Content .\server\sql\schema.sql -Raw | & "C:\Path\To\mariadb.exe" -u root -p
```

### 4. Cấu hình biến môi trường
Tạo file `.env` trong thư mục `server/` dựa trên file `.env.example`:
```dotenv
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=graphwar
```

### 5. Chạy dự án
```bash
npm run dev
```
- Client: `http://localhost:5173`
- Server: `ws://localhost:8080/ws`

## 👥 Thành viên thực hiện
- **Lường Văn Tâm**
- **Khương Thanh Tín**
- **Cao Thanh Phương**

---
*Dự án được thực hiện tại Trường Đại học Khoa học Tự nhiên - ĐHQGHN.*
