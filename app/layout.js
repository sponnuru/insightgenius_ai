import './globals.css';

export const metadata = {
  title: 'InsightGenius AI — Goal Tree',
  description: 'Map your goals as a tree, let AI break them into steps, and plan your day.',
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Apply the saved Day / Night choice before the page paints */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=JSON.parse(localStorage.getItem('ig-theme'));if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}" }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Manrope:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
