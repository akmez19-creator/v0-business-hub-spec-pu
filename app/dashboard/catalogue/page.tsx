import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AgentCatalogue } from '@/components/dashboard/agent-catalogue'
import { getCatalogueCategories } from '@/lib/agent-catalogue'

export const metadata = {
  title: 'Products - Business Hub',
  description: 'Look up a product, its price and whether it is in stock.',
}

const CAN_BROWSE = [
  'marketing_agent',
  'marketing_back_office',
  'marketing_front_office',
  'admin',
  'manager',
]

export default async function CataloguePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // The server action checks this too - this is only so the page does not
  // render an empty catalogue to someone who should not be here at all.
  if (!profile || !CAN_BROWSE.includes(profile.role)) redirect('/dashboard')

  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Products</h1>
        <p className="text-sm text-muted-foreground">
          Check a price and whether it is in stock before you promise it.
        </p>
      </header>
      <AgentCatalogue categories={await getCatalogueCategories()} />
    </main>
  )
}
