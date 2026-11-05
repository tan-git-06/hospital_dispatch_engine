import './globals.css';

export const metadata = {
  title: 'BedLink — Emergency Bed & Fleet Dispatch',
  description: 'Hospital emergency bed allocation and fleet dispatch engine',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
