import type { Result } from '@sniptt/monads'
import { Err, Ok } from '@sniptt/monads'

import { getDefaultSlippageDecimalPercentageForSwapper } from '../../../constants'
import type {
  SingleHopTradeQuoteSteps,
  SwapErrorRight,
  SwapperDeps,
  TradeQuote,
} from '../../../types'
import { SwapperName, TradeQuoteError } from '../../../types'
import { assertQuoteAddresses, makeSwapErrorRight } from '../../../utils'
import { FALLBACK_QUOTE_DEADLINE_MS } from '../../../utils/helpers'
import type { FyndTradeQuoteInput } from '../types'
import { FYND_RATE_ADDRESS } from '../utils/constants'
import { fetchFromFynd } from '../utils/fetchFromFynd'
import { getFyndStepData } from '../utils/getFyndStepData'
import { getFyndTradeContext } from '../utils/getFyndTradeContext'

export const getTradeQuote = async (
  input: FyndTradeQuoteInput,
  deps: SwapperDeps,
): Promise<Result<TradeQuote[], SwapErrorRight>> => {
  const requestStartedAt = Date.now()
  const maybeAddresses = assertQuoteAddresses(input)
  if (maybeAddresses.isErr()) return Err(maybeAddresses.unwrapErr())
  const { sendAddress, receiveAddress } = maybeAddresses.unwrap()
  if ([sendAddress, receiveAddress].some(address => address.toLowerCase() === FYND_RATE_ADDRESS)) {
    return Err(
      makeSwapErrorRight({
        message: 'Fynd executable quotes require wallet addresses',
        code: TradeQuoteError.InvalidResponse,
      }),
    )
  }

  const slippageTolerancePercentageDecimal =
    input.slippageTolerancePercentageDecimal ??
    getDefaultSlippageDecimalPercentageForSwapper(SwapperName.Fynd)
  const maybeFynd = await fetchFromFynd({
    sellAsset: input.sellAsset,
    buyAsset: input.buyAsset,
    chainId: input.chainId,
    sellAmountCryptoBaseUnit: input.sellAmountIncludingProtocolFeesCryptoBaseUnit,
    sender: sendAddress,
    receiver: receiveAddress,
    slippageTolerancePercentageDecimal,
    baseUrl: deps.config.VITE_FYND_BASE_URL,
  })
  if (maybeFynd.isErr()) return Err(maybeFynd.unwrapErr())
  const { quote, routerAddress } = maybeFynd.unwrap()
  const maybeContext = getFyndTradeContext({
    input,
    quote,
    routerAddress,
    slippageTolerancePercentageDecimal,
  })
  if (maybeContext.isErr()) return Err(maybeContext.unwrapErr())
  const { tradeCommon, stepCommon, protocolFees } = maybeContext.unwrap()

  const maybeStepData = await getFyndStepData({
    type: 'quote',
    input,
    deps,
    sellAsset: input.sellAsset,
    transaction: quote.transaction,
    from: sendAddress,
    spenderAddress: stepCommon.allowanceContract,
    sellAmountCryptoBaseUnit: input.sellAmountIncludingProtocolFeesCryptoBaseUnit,
  })
  if (maybeStepData.isErr()) return Err(maybeStepData.unwrapErr())
  const { transactionData, networkFeeCryptoBaseUnit } = maybeStepData.unwrap()

  const deadline = requestStartedAt + FALLBACK_QUOTE_DEADLINE_MS
  if (Date.now() >= deadline) {
    return Err(
      makeSwapErrorRight({
        message: 'Fynd quote expired while building',
        code: TradeQuoteError.Timeout,
      }),
    )
  }

  const tradeQuote: TradeQuote = {
    ...tradeCommon,
    deadline,
    quoteOrRate: 'quote',
    receiveAddress,
    steps: [
      {
        ...stepCommon,
        accountNumber: input.accountNumber,
        transactionData,
        feeData: { networkFeeCryptoBaseUnit, protocolFees },
      },
    ] as SingleHopTradeQuoteSteps,
  }

  return Ok([tradeQuote])
}
