import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NegoDigi APP",
  description:
    "Aplicación de NegoDigi para producción, clientes, equipo y finanzas.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/negodigi-logo.png",
    shortcut: "/negodigi-logo.png",
    apple: "/negodigi-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-theme="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
