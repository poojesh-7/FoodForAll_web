import "./globals.css";
import AppNavigation from "@/components/AppNavigation";
import AppToaster from "@/components/AppToaster";
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
          <SocketProvider>
            <AppNavigation />
            {children}
            <AppToaster />
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
