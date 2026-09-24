import { KnownChainIds } from '@shapeshiftoss/types'
import { describe, expect, it } from 'vitest'

import { TradeQuoteError } from '../../../types'
import { FYND_CHAINS } from './constants'
import { validateFyndInfoResponse, validateFyndQuoteResponse } from './validation'

const router = FYND_CHAINS['eip155:1'].routerAddress
const transaction = {
  to: router,
  value: '0',
  data: '0x12345678',
  client_fee_signature_offset: null,
}
const fees = {
  router_fee: '10',
  client_fee: '0',
  max_slippage: '5',
  min_amount_received: '985',
  swaps_hash: null,
}
const order = {
  order_id: 'test',
  status: 'success',
  amount_in: '1000',
  amount_out: '1000',
  gas_estimate: '21000',
  gas_price: null,
  price_impact_bps: -10,
  route: null,
  transaction,
  fee_breakdown: fees,
}
const context: Parameters<typeof validateFyndQuoteResponse>[1] = {
  chainId: KnownChainIds.EthereumMainnet,
  sellAmountCryptoBaseUnit: '1000',
  isNativeSell: false,
}
const validate = (overrides: Record<string, unknown>) =>
  validateFyndQuoteResponse({ orders: [{ ...order, ...overrides }] }, context)

describe('Fynd response validation', () => {
  it('accepts nullable gas price and signed price impact', () => {
    expect(validate({}).isOk()).toBe(true)
  })

  it.each([
    ['sell amount', { amount_in: '999' }],
    ['negative output', { amount_out: '-1' }],
    ['fractional base units', { amount_out: '0.5' }],
    ['exponent base units', { amount_out: '1e3' }],
    ['missing transaction', { transaction: null }],
    ['missing fees', { fee_breakdown: null }],
    ['fees exceed output', { fee_breakdown: { ...fees, router_fee: '1001' } }],
    ['unexpected client fee', { fee_breakdown: { ...fees, client_fee: '1' } }],
    [
      'router target',
      {
        transaction: {
          ...transaction,
          to: '0x1111111111111111111111111111111111111111',
        },
      },
    ],
    ['token transaction value', { transaction: { ...transaction, value: '1' } }],
    ['signature placeholder', { transaction: { ...transaction, client_fee_signature_offset: 4 } }],
    ['empty calldata', { transaction: { ...transaction, data: '0x' } }],
  ])('rejects inconsistent %s', (_label, overrides) => {
    const result = validate(overrides)
    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().code).toBe(TradeQuoteError.InvalidResponse)
  })

  it('binds native transaction value to the requested sell amount', () => {
    const nativeContext = { ...context, isNativeSell: true }
    expect(validateFyndQuoteResponse({ orders: [order] }, nativeContext).isErr()).toBe(true)
    expect(
      validateFyndQuoteResponse(
        {
          orders: [{ ...order, transaction: { ...transaction, value: '1000' } }],
        },
        nativeContext,
      ).isOk(),
    ).toBe(true)
  })

  it('requires exactly one response for the single requested order', () => {
    expect(validateFyndQuoteResponse({ orders: [] }, context).isErr()).toBe(true)
    expect(validateFyndQuoteResponse({ orders: [order, order] }, context).isErr()).toBe(true)
  })

  it.each([
    { chain_id: 8453, router_address: router },
    {
      chain_id: 1,
      router_address: '0x1111111111111111111111111111111111111111',
    },
    { chain_id: 1, router_address: null },
  ])('rejects info from another chain or router', info => {
    expect(validateFyndInfoResponse(info, KnownChainIds.EthereumMainnet).isErr()).toBe(true)
  })
})
