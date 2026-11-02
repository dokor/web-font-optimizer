import loadLocal from 'next/font/local';

const heading = loadLocal({
  src: [
    { path: './fonts/heading-regular.woff2', weight: '400', style: 'normal' },
    { path: '../assets/heading-variable.woff2', weight: '100 900', style: 'italic' },
  ],
  variable: '--font-heading',
});

export default () => <h1 className={heading.className}>Heading</h1>;
