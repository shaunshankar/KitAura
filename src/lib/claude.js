const CLAUDE_API_URL = '/api/claude'
const CLAUDE_MODEL = 'claude-sonnet-4-6'

function getHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function callClaude(prompt, base64Image, mediaType) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      errorData?.error?.message ||
        `Claude API error: ${response.status} ${response.statusText}`
    )
  }

  const data = await response.json()
  const text = data?.content?.[0]?.text
  if (!text) {
    throw new Error('No response text from Claude API')
  }
  return text
}

export async function scanInventory(base64Image, mediaType) {
  const prompt = `You are a kitchen inventory scanner. Analyze this image and identify all food items visible. Return ONLY a JSON array (no markdown, no explanation) with objects: { name, category (one of: produce/dairy/meat/grains/canned/frozen/beverages/snacks/condiments/bakery/other), quantity (number), unit (string), location (pantry/fridge/freezer) }. Be specific about quantities if visible, otherwise estimate 1.`

  try {
    const text = await callClaude(prompt, base64Image, mediaType)
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const result = JSON.parse(cleaned)
    if (!Array.isArray(result)) {
      throw new Error('Expected a JSON array from inventory scan')
    }
    return result
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('Failed to parse inventory scan results. Please try again with a clearer image.')
    }
    throw new Error(`Inventory scan failed: ${err.message}`)
  }
}

export async function scanMeal(base64Image, mediaType) {
  const prompt = `You are a nutrition analyst. Analyze this food image and estimate nutritional content. Return ONLY a JSON object (no markdown): { food_name, calories (number), protein_g (number), carbs_g (number), fat_g (number), servings (number, default 1) }. Provide reasonable estimates based on typical serving sizes.`

  try {
    const text = await callClaude(prompt, base64Image, mediaType)
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const result = JSON.parse(cleaned)
    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Expected a JSON object from meal scan')
    }
    return result
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('Failed to parse meal scan results. Please try again with a clearer image.')
    }
    throw new Error(`Meal scan failed: ${err.message}`)
  }
}

export async function scanReceipt(base64Image, mediaType) {
  const prompt = `You are a receipt scanner. Extract information from this grocery receipt. Return ONLY a JSON object (no markdown, no explanation):
{
  "store": string or null,
  "date": "YYYY-MM-DD" or null,
  "total": number or null,
  "item_count": number or null,
  "items": [{ "name": string, "quantity": number }]
}
For "items", list each grocery/food line item on the receipt. Normalise names to plain English (e.g. "GALA APPLES 1KG" → "Apples", "2% HOMO MILK 2L" → "Milk", "FREE RNG EGGS 12PK" → "Eggs"). Use quantity from the receipt line; default to 1 if unclear. Exclude non-food items (bags, fees, discounts). If you cannot determine store/date/total, use null.`

  try {
    const text = await callClaude(prompt, base64Image, mediaType)
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
    const result = JSON.parse(cleaned)
    if (typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Expected a JSON object from receipt scan')
    }
    return result
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error('Failed to parse receipt scan results. Please try again with a clearer image.')
    }
    throw new Error(`Receipt scan failed: ${err.message}`)
  }
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      // result is data:mediaType;base64,XXXXX — strip the prefix
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
export async function generateInventoryRecipes(inventory) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const annotated = inventory.map(i => {
    let expiringLabel = null
    if (i.expiry_date) {
      const exp = new Date(i.expiry_date)
      exp.setHours(0, 0, 0, 0)
      const diff = Math.floor((exp - now) / 86400000)
      if (diff <= 7) expiringLabel = diff <= 0 ? 'expired' : 'expiring soon'
    }
    return { name: i.name, quantity: i.quantity, unit: i.unit, expiringLabel }
  })

  const expiring = annotated.filter(i => i.expiringLabel)
    .map(i => `${i.name} (${i.quantity} ${i.unit}, ${i.expiringLabel})`)
  const normal = annotated.filter(i => !i.expiringLabel)
    .map(i => `${i.name} (${i.quantity} ${i.unit})`)

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: `You are a home kitchen recipe assistant. Generate 3 practical recipes using the user's available ingredients.

Return ONLY a valid JSON array of exactly 3 recipe objects. No markdown fences, no explanation.
Each object must have this exact shape:
{
  "name": string,
  "cook_time_mins": number,
  "difficulty": "Easy" | "Medium" | "Hard",
  "uses_expiring": [string],
  "ingredients": [
    { "name": string, "quantity": number, "unit": string, "in_inventory": boolean, "expiring": boolean }
  ],
  "steps": [string]
}

Rules:
- Prioritise ingredients that are expiring. At least 2 recipes must use at least one expiring item.
- For universal pantry staples (salt, pepper, water, oil) not listed, include if needed with in_inventory: true.
- Keep steps concise — one clear action each.
- Vary the 3 recipes in difficulty and cuisine style.`,
      messages: [{
        role: 'user',
        content: expiring.length
          ? `Items EXPIRING SOON — use these first:\n${expiring.join('\n')}\n\nOther available items:\n${normal.join('\n')}`
          : `Available items:\n${normal.join('\n')}`,
      }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Claude error: ${res.status}`)
  }

  const json = await res.json()
  const textBlock = json.content?.find(b => b.type === 'text')
  if (!textBlock) throw new Error('No recipes returned')

  const raw = textBlock.text.replace(/^```json\s*/i, '').replace(/```$/, '').trim()
  return JSON.parse(raw)
}

const RECIPE_SCHEMA_INSTRUCTIONS = `
Return JSON only, with this exact shape:
{
  "name": string,
  "description": string,
  "servings": number,
  "prep_time_min": number,
  "cook_time_min": number,
  "ingredients": [
    {
      "name": string,           // canonical name, e.g. "chicken breast"
      "quantity": number,
      "unit": string,           // one of: unit, g, kg, ml, L, oz, lb, cup, tbsp, tsp, pack, bunch, can, bottle, box
      "notes": string,          // e.g. "diced", "optional"
      "match_status": "have" | "low" | "missing",
      "matched_inventory_id": string | null  // id of matching inventory item, if any
    }
  ],
  "instructions": [string],
  "tags": [string]
}

Match ingredients to inventory generously (fuzzy match: "milk" matches "2% milk",
plurals/singular, common synonyms). Use "low" if quantity is below the recipe's needs,
"have" if sufficient, "missing" if not in inventory at all.
`

export async function generateRecipe({ query, url, inventory }) {
  const inventoryContext = JSON.stringify(
    inventory.map(i => ({
      id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, category: i.category,
    }))
  )

  const userPrompt = url
    ? `Fetch the recipe at this URL and extract it: ${url}`
    : `Generate a recipe for: ${query}`

  const headers = getHeaders(url ? { 'x-anthropic-beta': 'web-search-2025-03-05' } : {})

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: url ? [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 3 }] : undefined,
      system: `You are a recipe assistant. The user's current pantry/fridge/freezer inventory is:
${inventoryContext}

${RECIPE_SCHEMA_INSTRUCTIONS}`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData?.error?.message || `Claude error: ${res.status}`)
  }

  const json = await res.json()
  const textBlock = json.content.filter(b => b.type === 'text').pop()
  if (!textBlock) throw new Error('No recipe returned')

  const raw = textBlock.text.replace(/^```json\s*/i, '').replace(/```$/, '').trim()
  return JSON.parse(raw)
}