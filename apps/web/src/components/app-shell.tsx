'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import UpdateBanner from './layout/update-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <AccountProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-auto pt-[72px] lg:pt-0">
            <UpdateBanner />
            <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
              {children}
            </div>
          </main>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
