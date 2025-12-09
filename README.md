# 🎯 Graphwar - Trò chơi pháo hàm số

> **Đồ án Capstone - Phát triển Ứng dụng Web**  
> Trường Đại học Việt Nam

Graphwar là một trò chơi chiến thuật theo lượt nơi người chơi sử dụng các hàm số toán học để điều khiển quỹ đạo đạn và tiêu diệt đối thủ.

## 📖 Mô tả

Trong Graphwar, hai người chơi đối đầu trên một hệ tọa độ Descartes. Mỗi lượt, người chơi nhập một hàm số (ví dụ: `sin(x)`, `x^2`, `2*x + 1`) và đường đạn sẽ bay theo đồ thị của hàm số đó. Mục tiêu là bắn trúng đối thủ để chiến thắng!

### Tính năng chính

- 🎮 **Gameplay theo lượt** - 2 người chơi luân phiên bắn
- 📐 **Hàm số toán học** - Sử dụng sin, cos, tan, log, sqrt, và nhiều hàm khác
- 🎨 **Đồ họa Canvas** - Render mượt mà với HTML5 Canvas
- 🌐 **Multiplayer** - Chơi online qua Socket.io
- 🇻🇳 **Giao diện tiếng Việt** - UI hoàn toàn bằng tiếng Việt

## 🛠️ Công nghệ sử dụng

### Frontend
- **Next.js 14+** - React framework với App Router
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Zustand** - State management
- **mathjs** - Thư viện xử lý toán học
- **Socket.io Client** - Real-time communication

### Backend
- **Node.js + Express** - Server framework
- **Socket.io** - WebSocket cho multiplayer
- **TypeScript** - Type-safe code

## 📁 Cấu trúc dự án

```
graphwar/
├── frontend/                    # Next.js App
│   ├── src/
│   │   ├── app/                 # App Router pages
│   │   │   ├── page.tsx         # Trang chơi chính (local)
│   │   │   ├── lobby/           # Lobby multiplayer
│   │   │   ├── layout.tsx       # Root layout
│   │   │   └── globals.css      # Global styles
│   │   ├── components/
│   │   │   └── game/
│   │   │       ├── GameCanvas.tsx    # Canvas render
│   │   │       ├── ControlPanel.tsx  # UI điều khiển
│   │   │       └── GameInfo.tsx      # Thông tin game
│   │   ├── lib/
│   │   │   ├── math/            # Math parsing engine
│   │   │   │   └── parser.ts    # Core math logic
│   │   │   └── socket/          # Socket.io client
│   │   ├── stores/
│   │   │   └── gameStore.ts     # Zustand store
│   │   └── types/
│   │       └── game.ts          # TypeScript types
│   ├── package.json
│   └── tailwind.config.ts
│
├── backend/                     # Express Server
│   ├── src/
│   │   ├── index.ts             # Entry point
│   │   ├── types.ts             # Shared types
│   │   ├── socket/
│   │   │   └── handlers.ts      # Socket event handlers
│   │   └── game/
│   │       └── roomManager.ts   # Game room management
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

## 🚀 Hướng dẫn cài đặt

### Yêu cầu
- Node.js 18+ 
- npm hoặc yarn

### Cài đặt Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend sẽ chạy tại: `http://localhost:3000`

### Cài đặt Backend

```bash
cd backend
npm install
npm run dev
```

Backend sẽ chạy tại: `http://localhost:3001`

## 🎮 Cách chơi

### Chế độ Local (2 người 1 máy)
1. Truy cập `http://localhost:3000`
2. Người chơi 1 (Đội Đỏ) nhập hàm số và bấm "Bắn"
3. Người chơi 2 (Đội Xanh) nhập hàm số khi đến lượt
4. Bắn trúng đối thủ để giảm máu
5. Người còn sống cuối cùng thắng!

### Chế độ Multiplayer
1. Truy cập `http://localhost:3000/lobby`
2. Nhập tên và tạo phòng hoặc nhập mã phòng để tham gia
3. Chia sẻ mã phòng cho bạn bè
4. Bắt đầu chơi khi đủ 2 người!

### Các hàm số được hỗ trợ

| Hàm | Mô tả | Ví dụ |
|-----|-------|-------|
| `sin(x)` | Hàm sin | `sin(x)` |
| `cos(x)` | Hàm cos | `cos(x) * 2` |
| `tan(x)` | Hàm tan | `tan(x/4)` |
| `sqrt(x)` | Căn bậc hai | `sqrt(abs(x))` |
| `abs(x)` | Giá trị tuyệt đối | `abs(x)` |
| `log(x)` | Logarit tự nhiên | `log(x + 1)` |
| `exp(x)` | Hàm mũ | `exp(-x^2)` |
| `x^n` | Lũy thừa | `x^2`, `x^3` |
| `+, -, *, /` | Phép tính cơ bản | `2*x + 1` |

## 📝 API Documentation

### Socket Events

#### Client → Server
- `createRoom` - Tạo phòng mới
- `joinRoom` - Tham gia phòng
- `submitFunction` - Gửi hàm số để bắn
- `projectileHit` - Báo trúng đích
- `projectileMiss` - Báo trượt

#### Server → Client
- `roomCreated` - Phòng đã được tạo
- `roomJoined` - Đã vào phòng
- `gameStarted` - Game bắt đầu
- `projectileFired` - Đạn được bắn
- `playerHit` - Người chơi bị trúng
- `turnEnded` - Kết thúc lượt
- `gameOver` - Kết thúc game

## 🔧 Cấu hình

### Biến môi trường (Frontend)

Tạo file `.env.local`:
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

### Biến môi trường (Backend)

```env
PORT=3001
FRONTEND_URL=http://localhost:3000
```

## 🎨 Tùy chỉnh

### Thay đổi kích thước grid

Chỉnh sửa `DEFAULT_GRID_CONFIG` trong `frontend/src/types/game.ts`:

```typescript
export const DEFAULT_GRID_CONFIG: GridConfig = {
  width: 800,      // Chiều rộng canvas (px)
  height: 600,     // Chiều cao canvas (px)
  xMin: -20,       // Giá trị x nhỏ nhất
  xMax: 20,        // Giá trị x lớn nhất
  yMin: -15,       // Giá trị y nhỏ nhất
  yMax: 15,        // Giá trị y lớn nhất
  gridSpacing: 1,  // Khoảng cách lưới
};
```

### Thay đổi thông số game

Chỉnh sửa `GAME_CONSTANTS` trong `frontend/src/types/game.ts`:

```typescript
export const GAME_CONSTANTS = {
  PLAYER_RADIUS: 15,        // Bán kính người chơi
  PROJECTILE_RADIUS: 5,     // Bán kính đạn
  PROJECTILE_SPEED: 3,      // Tốc độ đạn
  MAX_HEALTH: 100,          // Máu tối đa
  HIT_DAMAGE: 50,           // Sát thương khi trúng
  ANIMATION_FPS: 60,        // FPS animation
  PATH_RESOLUTION: 0.05,    // Độ chi tiết đường đi
};
```

## 📜 License

MIT License - Tự do sử dụng cho mục đích học tập.

## 👨‍💻 Tác giả

Lường Văn Tâm
Khương Thanh Tín
Cao Thanh Phương

---

*Dự án cuối kỳ - Môn Phát triển Ứng dụng Web - 2025*
