import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Nova Aurora",description:"Economia virtual persistente — Tehkné Solutions"};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body>{children}</body></html>}
