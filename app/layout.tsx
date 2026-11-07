import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const display = localFont({
  src: '../public/fonts/Jersey10-Regular.ttf',
  variable: '--font-display',
  display: 'swap',
});
export const metadata: Metadata = {
  title: 'Aftertone — Your music, rediscovered.',
  description:
    'Turn album photos into a playlist. Connect Spotify or Apple Music and bring the favorites back.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable}>
      <body>{children}</body>
    </html>
  );
}
