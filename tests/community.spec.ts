import { test, expect } from "@playwright/test";

test("community supports public reading, authenticated posting and topic-specific drafts", async ({ page }) => {
  const topics = [
    { id: "maui", name: "Maui & Hawaiʻi", description: "Island observations." },
    { id: "world", name: "U.S. & world", description: "International reporting." },
  ];
  type Post = { id: string; text: string; author: string; source: string; at: string; own: boolean; canRemove: boolean; reported: boolean; flags: number };
  const messages: Record<string, Post[]> = { maui: [], world: [] };
  let signedIn = false;
  await page.route("**/api/preferences", route => route.fulfill({ json: {
    saved: [], topics: [], location: "Maui", notifications: false, history: [], account: { enabled: true, signedIn },
  } }));
  await page.route("**/api/feed?**", route => route.fulfill({ json: {
    events: [], health: [], nextCursor: null, updatedAt: new Date().toISOString(),
  } }));
  await page.route("**/api/community?**", async route => {
    const request = route.request();
    const topic = new URL(request.url()).searchParams.get("topic")!;
    if (request.method() === "POST") {
      const action = request.postDataJSON();
      expect(action.action).toBe("post");
      expect(action.nonce).toMatch(/^[a-f0-9-]{36}$/);
      expect(action).not.toHaveProperty("author");
      messages[topic].unshift({
        id: "test-" + messages[topic].length, text: action.text, source: action.source, author: "Reader TEST",
        at: new Date().toISOString(), own: true, canRemove: true, reported: false, flags: 0,
      });
    }
    await route.fulfill({ json: { topic, topics, messages: messages[topic], account: {
      enabled: true, alias: signedIn ? "Reader TEST" : null, unavailable: false,
    } } });
  });
  await page.goto("/community");
  await expect(page.getByRole("link", { name: "Sign in to post" })).toHaveAttribute("href", "/watchlist#account");
  await expect(page.getByRole("textbox", { name: /Post as/ })).toHaveCount(0);
  signedIn = true;
  await page.getByRole("button", { name: "Refresh discussion" }).click();
  const composer = page.getByRole("textbox", { name: /Post as/ });
  await composer.fill("Question about a public advisory.");
  await page.getByRole("link", { name: "U.S. & world" }).click();
  await expect(composer).toHaveValue("");
  await page.getByRole("link", { name: "Maui & Hawaiʻi" }).click();
  await expect(composer).toHaveValue("Question about a public advisory.");
  await page.getByRole("textbox", { name: "Source link (optional)" }).fill("https://weather.gov/");
  await page.getByRole("button", { name: "Post message" }).click();
  await expect(page.getByRole("list", { name: "Messages, newest first" })).toContainText("Question about a public advisory.");
  await expect(page.getByRole("link", { name: "weather.gov" })).toHaveAttribute("rel", /ugc/);
  await page.reload();
  await expect(page.getByRole("list", { name: "Messages, newest first" })).toContainText("Question about a public advisory.");
  await page.getByRole("link", { name: "U.S. & world" }).click();
  await expect(page).toHaveURL(/topic=world/);
  await expect(page.getByText("No messages in this topic yet.")).toBeVisible();
});
