import type { ChainId } from '@shapeshiftoss/caip'
import type { Asset } from '@shapeshiftoss/types'
import { bn } from '@shapeshiftoss/utils'
import type { Result } from '@sniptt/monads'
import { Err, Ok } from '@sniptt/monads'
import { isAddress, zeroAddress } from 'viem'

import type { SwapErrorRight } from '../../../types'
import { TradeQuoteError } from '../../../types'
import { makeSwapErrorRight } from '../../../utils'
import type { FyndEncodedQuote } from '../types'
import { FYND_CHAINS } from './constants'
import { createFyndService } from './fyndService'
import { assertValidTrade, convertAssetIdToFyndToken, isNativeFyndSell } from './helpers'
import { isFyndAmount, validateFyndInfoResponse, validateFyndQuoteResponse } from './validation'

type FetchFyndInput = {
  sellAsset: Asset
  buyAsset: Asset
  chainId?: ChainId
  sellAmountCryptoBaseUnit: string
  sender: string
  receiver: string
  slippageTolerancePercentageDecimal: string
  baseUrl: string
}

export const fetchFromFynd = async ({
  sellAsset,
  buyAsset,
  chainId: requestedChainId,
  sellAmountCryptoBaseUnit,
  sender,
  receiver,
  slippageTolerancePercentageDecimal,
  baseUrl,
}: FetchFyndInput): Promise<
  Result<{ quote: FyndEncodedQuote; routerAddress: string }, SwapErrorRight>
> => {
  const maybeTrade = assertValidTrade({ sellAsset, buyAsset, chainId: requestedChainId })
  if (maybeTrade.isErr()) return Err(maybeTrade.unwrapErr())
  const chainId = maybeTrade.unwrap()
  if (
    !isFyndAmount(sellAmountCryptoBaseUnit) ||
    !bn(sellAmountCryptoBaseUnit).gt(0) ||
    !isAddress(sender) ||
    !isAddress(receiver) ||
    sender.toLowerCase() === zeroAddress ||
    receiver.toLowerCase() === zeroAddress ||
    !/^0(?:\.\d+)?$/.test(slippageTolerancePercentageDecimal)
  ) {
    return Err(
      makeSwapErrorRight({
        message: 'Invalid Fynd amount, address or slippage',
        code: TradeQuoteError.InvalidResponse,
      }),
    )
  }
  const service = createFyndService({
    baseUrl: `${baseUrl.replace(/\/$/, '')}/${FYND_CHAINS[chainId].name}`,
  })
  const maybeInfo = await service.get<unknown>('/info')
  if (maybeInfo.isErr()) return Err(maybeInfo.unwrapErr())
  const maybeValidInfo = validateFyndInfoResponse(maybeInfo.unwrap().data, chainId)
  if (maybeValidInfo.isErr()) return Err(maybeValidInfo.unwrapErr())
  const { router_address: routerAddress } = maybeValidInfo.unwrap()

  const maybeResponse = await service.post<unknown>('/quote', {
    orders: [
      {
        token_in: convertAssetIdToFyndToken(sellAsset.assetId),
        token_out: convertAssetIdToFyndToken(buyAsset.assetId),
        amount: sellAmountCryptoBaseUnit,
        side: 'sell',
        sender,
        receiver,
      },
    ],
    options: {
      timeout_ms: 5_000,
      min_responses: 1,
      // The deployed API accepts a string despite its OpenAPI schema declaring a number.
      encoding_options: {
        slippage: slippageTolerancePercentageDecimal,
        transfer_type: 'transfer_from',
      },
    },
  })
  if (maybeResponse.isErr()) return Err(maybeResponse.unwrapErr())
  const maybeQuote = validateFyndQuoteResponse(maybeResponse.unwrap().data, {
    chainId,
    sellAmountCryptoBaseUnit,
    isNativeSell: isNativeFyndSell(sellAsset.assetId),
  })
  if (maybeQuote.isErr()) return Err(maybeQuote.unwrapErr())
  return Ok({ quote: maybeQuote.unwrap(), routerAddress })
}
