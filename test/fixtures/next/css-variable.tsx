import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export default () => <div className={inter.variable}>
  <p style={{ fontFamily: 'var(--font-inter), sans-serif' }}>Text</p>
</div>;
