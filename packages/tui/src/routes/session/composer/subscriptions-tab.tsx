import { createMemo, For, Show, createEffect, onMount, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { activeResourceSubscriptions } from "@opencode/util/resource-subscriptions"
import { useData } from "../../../context/data"
import { useTheme } from "../../../context/theme"
import { Keymap } from "../../../context/keymap"
import { useComposerTab } from "./context"

export function SubscriptionsTab(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const composer = useComposerTab()

  const entries = createMemo(() => activeResourceSubscriptions(data.session.message.list(props.sessionID)))

  const [store, setStore] = createStore({ selected: 0 })
  let scroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    if (store.selected >= entries().length) setStore("selected", Math.max(0, entries().length - 1))
  })

  createEffect(() => {
    const index = store.selected
    if (!scroll) return
    if (index >= scroll.scrollTop + scroll.viewport.height) scroll.scrollTo(index - scroll.viewport.height + 1)
    if (index < scroll.scrollTop) scroll.scrollTo(index)
  })

  onMount(() => {
    const cleanup = composer.register({
      id: "subscriptions",
      label: "Subscriptions",
      hints: () => [],
    })
    onCleanup(cleanup)
  })

  Keymap.createLayer(() => ({
    mode: "composer",
    enabled: () => composer.active("subscriptions"),
    priority: 1,
    commands: [
      {
        id: "composer.subscription.up",
        title: "Previous subscription",
        group: "Composer",
        run() {
          if (store.selected === 0) {
            composer.close()
            return
          }
          setStore("selected", (prev) => prev - 1)
        },
      },
      {
        id: "composer.subscription.down",
        title: "Next subscription",
        group: "Composer",
        run() {
          const list = entries()
          if (list.length === 0) return
          setStore("selected", (prev) => (prev + 1) % list.length)
        },
      },
    ],
  }))

  return (
    <Show when={composer.active("subscriptions")}>
      <scrollbox scrollbarOptions={{ visible: false }} maxHeight={5} ref={(r: ScrollBoxRenderable) => (scroll = r)}>
        <Show when={entries().length > 0} fallback={<text fg={theme.text.muted}> No resource subscriptions</text>}>
          <For each={entries()}>
            {(entry, index) => {
              const active = createMemo(() => index() === store.selected)
              return (
                <box
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  gap={1}
                  backgroundColor={
                    active() ? theme.background.action.primary.focused : theme.background.action.primary.base
                  }
                  onMouseMove={() => setStore("selected", index())}
                >
                  <text
                    fg={active() ? theme.text.action.primary.focused : theme.text.action.primary.base}
                    attributes={active() ? TextAttributes.BOLD : undefined}
                    wrapMode="none"
                  >
                    {entry.server}
                  </text>
                  <text
                    fg={active() ? theme.text.action.primary.focused : theme.text.muted}
                    wrapMode="none"
                    flexGrow={1}
                  >
                    {entry.uri}
                  </text>
                </box>
              )
            }}
          </For>
        </Show>
      </scrollbox>
    </Show>
  )
}
