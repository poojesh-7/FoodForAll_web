import "./globals.css";
import AppNavigation from "@/components/AppNavigation";
import AppToaster from "@/components/AppToaster";
import AuthProvider from "@/components/providers/authProvider";
import BrowserPushGate from "@/components/providers/BrowserPushGate";
import BrowserPushInitializer from "@/components/providers/BrowserPushInitializer";
import SocketProvider from "@/components/providers/SocketProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <AuthProvider>
          <SocketProvider>
            <BrowserPushInitializer />
            <BrowserPushGate />
            <AppNavigation />
            {children}
            <AppToaster />
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
