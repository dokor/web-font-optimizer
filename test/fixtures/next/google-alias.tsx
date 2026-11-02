import { Roboto_Mono as loadMono } from 'next/font/google';

const mono = loadMono({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-mono',
});

const alias = mono;
export default function Page() {
  return <main className={alias.className} style={mono.style}>Hello</main>;
}
