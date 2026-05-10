import "./globals.css";
import AuthProvider from "@/components/providers/authProvider";
import SocketProvider from "@/components/providers/SocketProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SocketProvider>{children}</SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
