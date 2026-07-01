// Brand loading spinner. The circle styling lives here so the same
// border/animate-spin string isn't copy-pasted across every page; override
// `className` for a different size or colour.

export function Spinner({ className = 'w-6 h-6 border-2 border-brand-900' }: { className?: string }) {
  return <div className={`${className} border-t-transparent rounded-full animate-spin`} />
}

/** The full-page "loading" state used while a page's first fetch resolves. */
export function PageLoading() {
  return (
    <div className="flex justify-center pt-12">
      <Spinner />
    </div>
  )
}
