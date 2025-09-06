// frontend/app/layout.js
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  metadataBase: new URL('http://localhost:3000'),
  title: 'PlanMate - AI Travel Companion',
  description: 'Your intelligent travel planning assistant that creates perfect itineraries in seconds',
  keywords: 'travel, planning, AI, itinerary, tourist, guide',
  authors: [{ name: 'PlanMate Team' }],
  openGraph: {
    title: 'PlanMate - AI Travel Companion',
    description: 'Plan your perfect day with AI-powered recommendations',
    type: 'website',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗺️</text></svg>" />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}