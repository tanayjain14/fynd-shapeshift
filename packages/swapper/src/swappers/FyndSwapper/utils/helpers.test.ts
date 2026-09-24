import { describe, expect, it } from 'vitest'

import { calculateFyndAmounts } from './helpers'

describe('Fynd fee calculations', () => {
  it('subtracts router and client fees from the expected output', () => {
    expect(
      calculateFyndAmounts({
        amountOut: '1000000',
        routerFee: '1010',
        clientFee: '4000',
      }),
    ).toEqual({
      buyAmountBeforeFeesCryptoBaseUnit: '1000000',
      buyAmountAfterFeesCryptoBaseUnit: '994990',
    })
  })

  it('preserves a zero-fee quote without inventing a router fee', () => {
    expect(
      calculateFyndAmounts({
        amountOut: '99999',
        routerFee: '0',
        clientFee: '0',
      }),
    ).toEqual({
      buyAmountBeforeFeesCryptoBaseUnit: '99999',
      buyAmountAfterFeesCryptoBaseUnit: '99999',
    })
  })

  it('keeps base-unit amounts exact beyond JavaScript integer precision', () => {
    expect(
      calculateFyndAmounts({
        amountOut: '1000000000000000001',
        routerFee: '1',
        clientFee: '0',
      }),
    ).toEqual({
      buyAmountBeforeFeesCryptoBaseUnit: '1000000000000000001',
      buyAmountAfterFeesCryptoBaseUnit: '1000000000000000000',
    })
  })
})
