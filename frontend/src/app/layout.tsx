import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Graphwar - Trò chơi pháo hàm số',
  description: 'Trò chơi chiến thuật sử dụng hàm số toán học để bắn đối thủ. Nhập hàm số như sin(x), x^2, và xem đường đạn bay theo quỹ đạo toán học!',
  keywords: ['game', 'toán học', 'hàm số', 'graphwar', 'multiplayer', 'vietnamese'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
