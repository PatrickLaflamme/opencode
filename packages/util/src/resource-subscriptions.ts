type ToolPart = {
  readonly type: string
  readonly id?: string
  readonly name?: string
  readonly state?: {
    readonly status?: string
    readonly input?: unknown
    readonly metadata?: unknown
    readonly content?: unknown
  }
}

export type ResourceSubscription = {
  readonly id: string
  readonly server: string
  readonly uri: string
}

const subscribe = "subscribe_mcp_resource"
const unsubscribe = "unsubscribe_mcp_resource"

// An update notice does not end the watch. Only a later unsubscribe, or a subscribe the server refused, does.
export function activeResourceSubscriptions(
  messages: readonly { readonly type: string; readonly content?: readonly unknown[] }[],
): ResourceSubscription[] {
  const active = new Map<string, ResourceSubscription>()
  for (const message of messages) {
    if (message.type !== "assistant" || message.content === undefined) continue
    for (const part of message.content) {
      if (!isToolPart(part) || part.state?.status !== "completed") continue
      const action = subscriptionAction(part.name)
      if (action === undefined) continue
      const server = textField(part.state.input, "server") ?? textField(part.state.metadata, "server")
      const uri = textField(part.state.input, "uri") ?? textField(part.state.metadata, "uri")
      if (server === undefined || uri === undefined) continue
      const key = `${server}\0${uri}`
      if (action === "unsubscribe" || honored(part.state) === false) {
        active.delete(key)
        continue
      }
      active.set(key, { id: part.id ?? key, server, uri })
    }
  }
  return [...active.values()]
}

function isToolPart(value: unknown): value is ToolPart & { name: string } {
  const fields = record(value)
  if (fields === undefined || fields.type !== "tool" || typeof fields.name !== "string") return false
  return true
}

function subscriptionAction(name: string) {
  if (name === subscribe || name.endsWith(`_${subscribe}`)) return "subscribe" as const
  if (name === unsubscribe || name.endsWith(`_${unsubscribe}`)) return "unsubscribe" as const
  return undefined
}

function record(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function textField(value: unknown, key: string) {
  const field = record(value)?.[key]
  if (typeof field !== "string" || field.length === 0) return undefined
  return field
}

function textBoolean(value: unknown, key: string) {
  const field = record(value)?.[key]
  if (typeof field !== "boolean") return undefined
  return field
}

function textParts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((part) => {
    const fields = record(part)
    if (fields === undefined || typeof fields.type !== "string") return []
    return [{ type: fields.type, text: typeof fields.text === "string" ? fields.text : undefined }]
  })
}

function honored(state: NonNullable<ToolPart["state"]>) {
  const recorded = textBoolean(state.metadata, "honored")
  if (recorded !== undefined) return recorded
  const text = textParts(state.content).find((part) => part.type === "text")?.text
  if (text === undefined) return true
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null && "honored" in parsed) return parsed.honored !== false
  } catch {
    return true
  }
  return true
}
