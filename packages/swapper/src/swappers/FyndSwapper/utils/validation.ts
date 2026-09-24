import { BigNumber, bn } from '@shapeshiftoss/utils'
import type { Result } from '@sniptt/monads'
import { Err, Ok } from '@sniptt/monads'

import type { SwapErrorRight } from '../../../types'
import { TradeQuoteError } from '../../../types'
import { makeSwapErrorRight } from '../../../utils'
import type { FyndEncodedQuote, FyndFeeBreakdown } from '../types'
import type { FyndSupportedChainId } from './constants'
import { FYND_CHAINS } from './constants'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const MAX_UINT256 = (2n ** 256n - 1n).toString()
export const isFyndAmount = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,78}$/.test(value) && bn(value).lte(MAX_UINT256)

const invalidResponse = (message: string): SwapErrorRight =>
  makeSwapErrorRight({ message, code: TradeQuoteError.InvalidResponse })

const isValidFeeBreakdown = (value: unknown): value is FyndFeeBreakdown =>
  isRecord(value) &&
  isFyndAmount(value.router_fee) &&
  isFyndAmount(value.client_fee) &&
  isFyndAmount(value.max_slippage) &&
  isFyndAmount(value.min_amount_received)

export const validateFyndQuoteResponse = (
  value: unknown,
  {
    chainId,
    sellAmountCryptoBaseUnit,
    isNativeSell,
    slippageTolerancePercentageDecimal,
  }: {
    chainId: FyndSupportedChainId
    sellAmountCryptoBaseUnit: string
    isNativeSell: boolean
    slippageTolerancePercentageDecimal: string
  },
): Result<FyndEncodedQuote, SwapErrorRight> => {
  if (!isRecord(value) || !Array.isArray(value.orders) || value.orders.length !== 1) {
    return Err(invalidResponse('Fynd must return exactly one order'))
  }
  const quote: unknown = value.orders[0]
  if (!isRecord(quote)) return Err(invalidResponse('Fynd returned an invalid order'))
  if (quote.status !== 'success') {
    const code =
      quote.status === 'no_route_found' || quote.status === 'insufficient_liquidity'
        ? TradeQuoteError.NoRouteFound
        : TradeQuoteError.QueryFailed
    return Err(
      makeSwapErrorRight({
        message: `Fynd quote failed: ${String(quote.status)}`,
        code,
      }),
    )
  }
  const { transaction, fee_breakdown: fees } = quote
  if (
    !isFyndAmount(quote.amount_in) ||
    !bn(quote.amount_in).eq(sellAmountCryptoBaseUnit) ||
    !isFyndAmount(quote.amount_out) ||
    !bn(quote.amount_out).gt(0) ||
    !isFyndAmount(quote.gas_estimate) ||
    !bn(quote.gas_estimate).gt(0) ||
    (quote.gas_price !== null && quote.gas_price !== undefined && !isFyndAmount(quote.gas_price)) ||
    (quote.price_impact_bps !== null &&
      quote.price_impact_bps !== undefined &&
      (typeof quote.price_impact_bps !== 'number' ||
        !Number.isSafeInteger(quote.price_impact_bps))) ||
    !isValidFeeBreakdown(fees) ||
    !bn(fees.client_fee).isZero() ||
    !bn(fees.min_amount_received).gt(0) ||
    !bn(fees.router_fee)
      .plus(fees.client_fee)
      .plus(fees.max_slippage)
      .plus(fees.min_amount_received)
      .eq(quote.amount_out) ||
    !isRecord(transaction) ||
    typeof transaction.to !== 'string' ||
    transaction.to.toLowerCase() !== FYND_CHAINS[chainId].routerAddress ||
    typeof transaction.data !== 'string' ||
    !/^0x(?:[a-fA-F0-9]{2}){4,}$/.test(transaction.data) ||
    !isFyndAmount(transaction.value) ||
    !bn(transaction.value).eq(isNativeSell ? sellAmountCryptoBaseUnit : '0') ||
    (transaction.client_fee_signature_offset !== null &&
      transaction.client_fee_signature_offset !== undefined) ||
    (quote.route !== null &&
      quote.route !== undefined &&
      (!isRecord(quote.route) ||
        !Array.isArray(quote.route.swaps) ||
        !quote.route.swaps.every(
          (swap: unknown) => isRecord(swap) && typeof swap.protocol === 'string',
        )))
  ) {
    return Err(invalidResponse('Fynd returned an invalid encoded quote'))
  }
  // Fynd quantizes slippage to six decimals, then floors the deduction from net output.
  const netAmount = bn(quote.amount_out).minus(fees.router_fee).minus(fees.client_fee)
  const slippageMillionths = bn(slippageTolerancePercentageDecimal)
    .times(1_000_000)
    .integerValue(BigNumber.ROUND_DOWN)
  const maxSlippage = netAmount
    .times(slippageMillionths)
    .div(1_000_000)
    .integerValue(BigNumber.ROUND_DOWN)
  if (bn(fees.max_slippage).gt(maxSlippage)) {
    return Err(invalidResponse('Fynd slippage exceeds the requested tolerance'))
  }
  return Ok(quote as FyndEncodedQuote)
}
