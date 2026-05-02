'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'

import { JsonPasteModal } from './JsonPasteModal'

// Header strip that pairs the page title with the two primary
// actions an operator wants on the library page: build a fresh
// strategy from the visual builder, or paste an existing JSON
// document. The paste modal lives here so its state stays scoped
// to the actions row instead of bubbling up to the server page.
export function StrategyLibraryHeader() {
  const [pasteOpen, setPasteOpen] = useState(false)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="w-auto"
        onClick={() => setPasteOpen(true)}
      >
        Paste JSON
      </Button>
      <Link href="/settings/strategies/new" className="contents">
        <Button className="w-auto">Build new</Button>
      </Link>
      <JsonPasteModal open={pasteOpen} onClose={() => setPasteOpen(false)} />
    </div>
  )
}
