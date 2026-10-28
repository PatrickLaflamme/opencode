import { expect, story } from "../../storybook/playwright/story"

story("shows a resource subscription event like a background completion", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "notices" } })
  const notice = timeline.locator('[data-slot="session-timeline-notice"]').filter({
    hasText: "Event for subscription to docs://readme received",
  })
  await expect(notice).toBeVisible()
  await expect(notice).toHaveCount(1)
})
