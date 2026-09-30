import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KITT — Voice AI Assistant',
  description: 'A voice-first AI assistant inspired by the classic 1982 Knight Industries Two Thousand interface.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Required for env(safe-area-inset-*) to report real notch/cutout values.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}