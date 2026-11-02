import { Inter as GoogleInter } from 'next/font/google';
import localFont from 'next/font/local';
import '../shared.css';
import '../duplicates.css';
const inter = GoogleInter({ weight: '400', style: 'normal', variable: '--font-next' });
const local = localFont({ src: './fonts/local.woff2', weight: '700' });
export default function Layout({ children }) {
  return <html><body className={`${inter.className} ${inter.variable} ${local.className}`}>{children}</body></html>;
}
throw new Error('The audited application must never execute.');
