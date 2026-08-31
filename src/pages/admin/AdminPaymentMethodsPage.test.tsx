import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminPaymentMethodsPage } from './AdminPaymentMethodsPage'
import type { PaymentMethod } from '../../types/database'

const { fetchPaymentMethods, savePaymentMethod, deletePaymentMethod } = vi.hoisted(() => ({
  fetchPaymentMethods: vi.fn(),
  savePaymentMethod: vi.fn(),
  deletePaymentMethod: vi.fn(),
}))
vi.mock('../../lib/payment-methods', () => ({
  fetchPaymentMethods: (...a: unknown[]) => fetchPaymentMethods(...a),
  savePaymentMethod: (...a: unknown[]) => savePaymentMethod(...a),
  deletePaymentMethod: (...a: unknown[]) => deletePaymentMethod(...a),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

function row(over: Partial<PaymentMethod> & { id: string; key: string; label: string }): PaymentMethod {
  return {
    created_at: '', created_by: null, blurb: null, surcharge_percent: 0,
    bank_name: null, bank_branch: null, bank_code: null,
    account_number: null, account_holder: null, swift_bic: null,
    pay_url: null, notes: null,
    collects_invoice_email: false, shows_shop_contact: false,
    sort_order: 0, active: true,
    ...over,
  } as PaymentMethod
}

const rows: PaymentMethod[] = [
  row({ id: 'm1', key: 'bank_transfer', label: 'Domestic bank transfer', account_number: '1234-5678-9012' }),
  row({ id: 'm2', key: 'credit_card', label: 'Credit card', surcharge_percent: 5, active: false }),
]

beforeEach(() => {
  fetchPaymentMethods.mockReset().mockResolvedValue(rows)
  savePaymentMethod.mockReset().mockResolvedValue(undefined)
  deletePaymentMethod.mockReset().mockResolvedValue(undefined)
})

const renderPage = () => render(<MemoryRouter><AdminPaymentMethodsPage /></MemoryRouter>)

describe('AdminPaymentMethodsPage', () => {
  it('lists methods with their surcharge, hidden flag and the account divers send to', async () => {
    renderPage()
    expect(await screen.findByText('Domestic bank transfer')).toBeInTheDocument()
    expect(screen.getByText('1234-5678-9012')).toBeInTheDocument()
    expect(screen.getByText('Credit card (+5%)')).toBeInTheDocument()
    expect(screen.getByText(/hidden/i)).toBeInTheDocument()
  })

  it('saves a new method with its bank details and key', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Domestic bank transfer')
    await user.click(screen.getByRole('button', { name: /new method/i }))

    await user.type(screen.getByLabelText(/name shown to divers/i), 'International bank transfer')
    await user.type(screen.getByLabelText(/^key/i), 'bank_transfer_intl')
    await user.type(screen.getByLabelText(/^bank name/i), 'CTBC Bank')
    await user.type(screen.getByLabelText(/account number/i), '9876-5432')
    await user.type(screen.getByLabelText(/^swift \/ bic$/i), 'CTCBTWTP')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(savePaymentMethod).toHaveBeenCalled())
    const [values, id] = savePaymentMethod.mock.calls[0]
    expect(id).toBeUndefined()
    expect(values).toMatchObject({
      key: 'bank_transfer_intl',
      label: 'International bank transfer',
      bank_name: 'CTBC Bank',
      account_number: '9876-5432',
      swift_bic: 'CTCBTWTP',
      surcharge_percent: 0,
    })
    // Blank rows are stored as null, not empty strings, so the renderer can
    // simply skip them.
    expect(values.bank_branch).toBeNull()
  })

  it('previews the diver-facing block as the account is typed', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Domestic bank transfer')
    await user.click(screen.getByRole('button', { name: /new method/i }))

    await user.type(screen.getByLabelText(/name shown to divers/i), 'Post office transfer')
    await user.type(screen.getByLabelText(/account number/i), '700-1234')

    expect(screen.getByText(/how to pay — post office transfer/i)).toBeInTheDocument()
    expect(screen.getByText(/700-1234/)).toBeInTheDocument()
  })

  // The key is what every booking records; changing it would orphan the money
  // trail, so an existing method's key is fixed.
  it('locks the key when editing an existing method', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Domestic bank transfer')
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0])

    expect(screen.getByLabelText(/^key/i)).toBeDisabled()
    expect(screen.getByLabelText(/^key/i)).toHaveValue('bank_transfer')
  })

  it('rejects a key that is not a lowercase slug rather than letting the DB reject it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Domestic bank transfer')
    await user.click(screen.getByRole('button', { name: /new method/i }))

    await user.type(screen.getByLabelText(/name shown to divers/i), 'Wire')
    await user.type(screen.getByLabelText(/^key/i), 'Bank Transfer!')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(savePaymentMethod).not.toHaveBeenCalled()
  })

  it('warns that deleting breaks existing bookings, and offers hiding instead', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Domestic bank transfer')
    await user.click(screen.getAllByRole('button', { name: /^delete$/i })[0])

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/hiding it instead keeps old bookings whole/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deletePaymentMethod).toHaveBeenCalledWith('m1'))
  })
})
