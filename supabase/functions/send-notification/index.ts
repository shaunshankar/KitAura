import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = 'KitAura <onboarding@resend.dev>'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Item {
  name: string
  quantity: number
  unit: string
}

interface Recipient {
  email: string
  name: string
}

function bullet(item: Item): string {
  const qty = item.quantity ?? 1
  const unit = item.unit && item.unit !== 'unit' ? `${qty} ${item.unit}` : `x${qty}`
  return `• ${item.name} — ${unit}`
}

function buildText(
  type: string,
  recipientName: string,
  senderName: string,
  itemLines: string,
  total: number,
): string {
  const divider = '─────────────────────────────'
  const footer = `\nKind regards,\nThe KitAura App\n\n${divider}\nThis notification was sent automatically by KitAura on behalf of your household.`

  if (type === 'shopping_approval') {
    return `Dear ${recipientName},

This is a notification from KitAura that ${senderName} has prepared the household shopping list and is ready to proceed with the Woolworths order.

Please review the items below before the shop is completed. If you have any additions or concerns, please contact ${senderName} directly.

SHOPPING LIST
${divider}
${itemLines}

TOTAL ITEMS: ${total}

This shop will proceed shortly. Please raise any concerns as soon as possible.
${footer}`
  }

  return `Dear ${recipientName},

This is a notification from KitAura that ${senderName} has completed the household shopping.

The following items have been purchased and the shopping list has been updated accordingly.

ITEMS PURCHASED
${divider}
${itemLines}

TOTAL ITEMS PURCHASED: ${total}

Your KitAura inventory and shopping list have been updated.
${footer}`
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const { type, recipients, items, senderName } = await req.json() as {
      type: string
      recipients: Recipient[]
      items: Item[]
      senderName: string
    }

    if (!recipients?.length) {
      return new Response(
        JSON.stringify({ success: true, skipped: 'no recipients' }),
        { headers: { ...cors, 'Content-Type': 'application/json' } },
      )
    }

    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY secret is not set on this function')
    }

    const subject = type === 'shopping_approval'
      ? 'KitAura — Household Shopping List Ready for Review'
      : 'KitAura — Household Shopping Completed'

    const itemLines = items.map(bullet).join('\n')

    const results = await Promise.allSettled(
      recipients.map(async ({ email, name }) => {
        const text = buildText(type, name || 'Household Member', senderName, itemLines, items.length)

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: FROM, to: [email], subject, text }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err?.message ?? `Resend error ${res.status}`)
        }

        return res.json()
      }),
    )

    const failed = results.filter(r => r.status === 'rejected')
    const errors = (failed as PromiseRejectedResult[]).map(r => r.reason?.message)

    return new Response(
      JSON.stringify({
        success: true,
        sent: results.length - failed.length,
        failed: failed.length,
        errors,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('send-notification error:', err)
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } },
    )
  }
})
