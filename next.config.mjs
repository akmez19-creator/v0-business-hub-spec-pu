import { withWorkflow } from 'workflow/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    /*
     * A receipt photo is routinely 2-5MB from a phone, and Next's DEFAULT
     * server-action body limit is 1MB - which would refuse the upload before
     * `importPurchaseDocumentAction` ever runs, showing only "Failed to fetch".
     * Raised to match the action's own 20MB check so the size gate lives in
     * application code where it can give an honest message.
     *
     * NOT the cause of the import failure I was chasing: I asserted it was and
     * was WRONG - a 1004425-byte upload reached the model fine while the
     * 984042-byte one failed. Kept because the default genuinely is 1MB and
     * real phone photos exceed it, but the limit was never the bug.
     */
    serverActions: { bodySizeLimit: '20mb' },
  },
}

export default withWorkflow(nextConfig)
