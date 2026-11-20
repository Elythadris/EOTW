import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "block" });
test("Finance keeps daily evidence usable when the quote provider or next refresh fails", async ({ page }) => {
  const checkedAt = "2026-11-19T18:00:00Z";
  const series = {
    symbol: "EURUSD", label: "Euro / U.S. dollar", unit: "USD per EUR", kind: "fx", precision: 4,
    source: "European Central Bank", sourceUrl: "https://www.ecb.europa.eu/", asOf: "2026-11-19",
    points: [{date: "2026-11-18", value: 1.0981},{date: "2026-11-19", value: 1.0992}],
    change: 0.10017, unitChange: "%", comparison: null, stale: false, narrative: "ECB daily observation.",
  };
  let healthy = true;
  await page.route("**://www.tradingview-widget.com/**", route => route.abort());
  await page.route("**/api/finance", route => route.fulfill(healthy
    ? {json: { checkedAt, series: [series], auctions: [], sources: [{name:"TreasuryDirect",status:"ok",url:"https://www.treasurydirect.gov/"}] }}
    : {status:503,json:{error:"temporarily unavailable"}}));
  await page.goto("/finance");
  const direct = page.getByRole("link", {name:"Open BTC/USD chart on TradingView"});
  await expect(direct).toHaveAttribute("href", "https://www.tradingview.com/symbols/BITSTAMP-BTCUSD/");
  await page.getByRole("button", {name:"AAPL",exact:true}).click();
  await expect(page.getByRole("link",{name:"Open AAPL chart on TradingView"})).toHaveAttribute("href","https://www.tradingview.com/symbols/NASDAQ-AAPL/");
  await page.getByRole("button", {name:"Rates & FX",exact:true}).click();
  await expect(page.getByRole("combobox",{name:"Reference series"})).toHaveValue("EURUSD");
  const slider = page.getByRole("slider",{name:"Inspect Euro / U.S. dollar observation"});
  await expect(slider).toHaveValue("1");
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(page.locator(".fin-reader output")).toContainText("1.0981");
  await expect(page.getByRole("link",{name:"Source observations"})).toHaveAttribute("href",series.sourceUrl);
  await expect(page.getByRole("button",{name:"Ask about EURUSD"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Search manipulation reports"})).toHaveAttribute("href","/archive?q=market%20manipulation");
  healthy = false;
  await page.getByRole("button",{name:"Refresh financial data"}).click();
  await expect(page.getByText(/Showing the last response for this visit/)).toBeVisible();
  await expect(slider).toHaveValue("0");
});
