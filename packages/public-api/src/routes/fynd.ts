import { FYND_CHAINS } from '@shapeshiftoss/swapper'
import type { Request, Response } from 'express'
import { z } from 'zod'

import { env } from '../env'

const FYND_URL = 'https://fynd-api.propellerheads.xyz/v1'
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const orderSchema = z
  .object({
    token_in: address,
    token_out: address,
    amount: z.string().regex(/^[1-9][0-9]{0,77}$/),
    side: z.literal('sell'),
    sender: address,
    receiver: address,
  })
  .strict()
const quoteSchema = z
  .object({
    orders: z.tuple([orderSchema]),
    options: z
      .object({
        timeout_ms: z.number().int().min(1).max(5_000),
        min_responses: z.literal(1),
        encoding_options: z
          .object({
            slippage: z.string().regex(/^0(?:\.\d+)?$/),
            transfer_type: z.literal('transfer_from'),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

const forwardFynd = async (
  req: Request,
  res: Response,
  endpoint: 'info' | 'quote',
): Promise<void> => {
  if (!Object.values(FYND_CHAINS).some(chain => chain.name === req.params.chain)) {
    res.status(400).json({ error: 'Unsupported Fynd chain' })
    return
  }
  if (!env.FYND_API_KEY) {
    res.status(503).json({ error: 'Fynd is not configured' })
    return
  }

  const parsed = endpoint === 'quote' ? quoteSchema.safeParse(req.body) : undefined
  if (parsed && !parsed.success) {
    res.status(400).json({ error: 'Invalid Fynd quote request' })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${FYND_URL}/${req.params.chain}/${endpoint}`, {
      method: endpoint === 'info' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: env.FYND_API_KEY },
      ...(parsed?.success && { body: JSON.stringify(parsed.data) }),
      signal: controller.signal,
      redirect: 'error',
    })
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after')
      if (retryAfter) res.setHeader('Retry-After', retryAfter)
      res.status(response.status).json({ error: 'Fynd request failed' })
      return
    }
    const body: unknown = await response.json()
    res.status(200).json(body)
  } catch {
    res
      .status(controller.signal.aborted ? 504 : 502)
      .json({ error: controller.signal.aborted ? 'Fynd request timed out' : 'Fynd unavailable' })
  } finally {
    clearTimeout(timeout)
  }
}

export const getFyndInfo = (req: Request, res: Response): Promise<void> =>
  forwardFynd(req, res, 'info')

export const getFyndQuote = (req: Request, res: Response): Promise<void> =>
  forwardFynd(req, res, 'quote')
