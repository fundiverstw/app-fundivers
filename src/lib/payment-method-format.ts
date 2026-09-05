// Rendering rules for a shop-authored payment method, shared verbatim by the
// register forms and the emailed PDF. Import-free on purpose (like
// event-kinds.ts) so the Deno edge functions can pull it in directly: the
// deployment's field labels and the shop's contact details are injected by the
// caller, which is what keeps the browser's "How to pay" block and the PDF's
// from drifting apart.

/** The columns of public.payment_methods this module reads. Structural rather
 *  than the generated Row type so Deno can use it without src/types. */
export interface PaymentMethodDetails {
  key: string
  label: string
  blurb?: string | null
  surcharge_percent: number
  bank_name?: string | null
  bank_branch?: string | null
  bank_code?: string | null
  account_number?: string | null
  account_holder?: string | null
  swift_bic?: string | null
  pay_url?: string | null
  notes?: string | null
  collects_invoice_email: boolean
  shows_shop_contact: boolean
}

/** Field labels, supplied from the deployment's message catalog. */
export interface PaymentMethodLabels {
  howToPay: (label: string) => string
  bankName: (v: string) => string
  bankBranch: (v: string) => string
  bankCode: (v: string) => string
  accountNumber: (v: string) => string
  accountHolder: (v: string) => string
  swift: (v: string) => string
  payOnline: (v: string) => string
  phone: (v: string) => string
  address: (v: string) => string
  map: (v: string) => string
  invoiceTo: (v: string) => string
  registeredEmail: string
  /** Shown for a transfer method whose bank fields the shop hasn't filled in. */
  bankDetailsPending: string
}

export interface ShopContact {
  phone: string
  address: string
  /** Nullable, because the shop authors it and a shop with no map link is an
   *  ordinary shop rather than a misconfigured one. */
  mapsUrl: string | null
}

export interface PaymentInstructions {
  title: string
  lines: string[]
}

const filled = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : null
}

/** The method's surcharge as a multiplier of the subtotal. */
export function surchargeRateFor(
  method: Pick<PaymentMethodDetails, 'surcharge_percent'> | null | undefined,
): number {
  const pct = Number(method?.surcharge_percent ?? 0)
  return Number.isFinite(pct) && pct > 0 ? pct / 100 : 0
}

/** The method's display name, suffixed with its surcharge when it carries one. */
export function paymentMethodLabel(
  method: Pick<PaymentMethodDetails, 'label' | 'surcharge_percent'>,
): string {
  const pct = Number(method.surcharge_percent ?? 0)
  return pct > 0 ? `${method.label} (+${pct}%)` : method.label
}

/** True once the shop has published anything a diver could transfer money to. */
export function hasTransferDetails(method: PaymentMethodDetails): boolean {
  return !!(
    filled(method.bank_name) || filled(method.account_number) ||
    filled(method.account_holder) || filled(method.swift_bic) ||
    filled(method.bank_code) || filled(method.bank_branch) ||
    filled(method.pay_url)
  )
}

/**
 * Build the "How to pay" block for a method. `invoiceEmail` only applies to a
 * method that collects one — when blank, the block falls back to the diver's
 * registered email.
 */
export function paymentMethodInstructions(
  method: PaymentMethodDetails,
  ctx: {
    labels: PaymentMethodLabels
    shop: ShopContact
    invoiceEmail?: string | null
  },
): PaymentInstructions {
  const { labels: l, shop } = ctx
  const lines: string[] = []

  for (const line of (method.notes ?? '').split('\n')) {
    const s = line.trim()
    if (s) lines.push(s)
  }

  const payUrl = filled(method.pay_url)
  if (payUrl) lines.push(l.payOnline(payUrl))

  const bank: Array<[string | null, (v: string) => string]> = [
    [filled(method.bank_name), l.bankName],
    [filled(method.bank_branch), l.bankBranch],
    [filled(method.bank_code), l.bankCode],
    [filled(method.account_number), l.accountNumber],
    [filled(method.account_holder), l.accountHolder],
    [filled(method.swift_bic), l.swift],
  ]
  for (const [value, label] of bank) if (value) lines.push(label(value))

  // A transfer method with nothing published yet would otherwise render a bare
  // memo instruction and no account to send money to. Say so instead.
  if (!hasTransferDetails(method) && !method.shows_shop_contact && !method.collects_invoice_email) {
    lines.push(l.bankDetailsPending)
  }

  // A blank detail prints nothing rather than a labelled empty line: a shop
  // that has published no address should not have "Address:" in its emails.
  if (method.shows_shop_contact) {
    const details: Array<[string | null, (v: string) => string]> = [
      [filled(shop.phone), l.phone],
      [filled(shop.address), l.address],
      [filled(shop.mapsUrl), l.map],
    ]
    for (const [value, label] of details) if (value) lines.push(label(value))
  }

  if (method.collects_invoice_email) {
    lines.push(l.invoiceTo(filled(ctx.invoiceEmail) ?? l.registeredEmail))
  }

  return { title: l.howToPay(paymentMethodLabel(method)), lines }
}
