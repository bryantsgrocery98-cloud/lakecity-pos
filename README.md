# Lake City POS (prototype)

A free, touch-first point of sale for a small convenience store. Runs on one Windows laptop, keeps everything on that computer, and works with no internet.

**What works in this build (milestones 1 to 3):**

- PIN login on an on-screen keypad (demo PINs: cashier `1111`, manager `2222`, owner `3333`)
- Touch checkout: one-click pages (ICE COLD BEER, Checks & Services, Gas, No Code Items), frequent items, search
- USB barcode scanner in keyboard mode: scans add items; unknown codes open "Link this barcode"
- Revenue authorities: Alcohol 8%, Food and Drink 1%, Grocery All 8%, Motor oils 8%, Tobacco 8%, each shown by name on the ticket and receipt
- Lottery (amount x tickets, no tax, counted separately) and Lottery Payout
- Ask-at-sale items (Non-listed Item, Check Cashing Fee)
- Age check: scan the back of a driver's license with a 2D scanner, or manual date with a manager PIN ("Scan ID only" is ON by default)
- Hold / Recall, No Sale, ticket discount buttons, large-quantity and large-total warnings
- Cash (change due) and card (reference number) payment, receipt printed through the Windows print dialog
- "Today" summary: sales, tax by authority, sales by category, lottery, No Sale count
- Immutable audit log; 41 unit tests for money, tax, ticket math, workday cutoff, and the ID parser

**Not yet built:** price book import, bulk editing, product images, refunds and corrections, shifts and Z report, ESC/POS printer and cash-drawer kick, Google Drive backup, Windows installer. Those are the later milestones in the build prompt.

> NEEDS VERIFICATION: the tax rates are copied from the store's current settings. Confirm them with the SC Department of Revenue. The ID-check rules need a check against SC law.

## Run it on the store computer

1. Install Node.js 22 (LTS) from https://nodejs.org. Accept the defaults.
2. Unzip `lakecity-pos.zip` into a folder, for example `C:\POS`.
3. Double-click `setup-windows.bat` once. It installs the parts (needs internet once, about a minute), puts a **Bryants POS** icon on the desktop, and makes the register start by itself when you sign in to Windows.
4. The register opens full screen in its own window. (Press **F11** to leave full screen; `start-pos.bat` opens it with a console window if you ever need to see messages.)
5. Sign in with PIN `1111`.

Updates install themselves: the register checks every hour and reloads its own screen between tickets. Logs are in `data\logs\pos.log`.

The cash drawer plugs into the receipt printer's drawer port. It opens on cash sales, cash refunds, and the **Open Register** button.

The register is only reachable from that computer. Nothing is exposed to the network.

Your data lives in `data\pos.db` next to the app. Copy that file to keep a backup until Drive backup is built.

## Scanner and ID check

- Any USB scanner in **keyboard mode** works. Test: open Notepad, scan an item; the number should appear, then a new line.
- To check IDs the scanner must read **PDF417** (a 2D imager). Scan the back of a license into Notepad; a block of text starting with `@` and containing `ANSI` means it will work.
- Nothing from the ID is saved. Only the result (passed/failed), the time, the cashier and the ticket number go in the audit log.

## For developers

```
npm install
npm run dev        # server on 3000 + Vite on 5173
npm test           # unit tests
npm run build      # builds the web app into dist/web
npm start          # production: serves dist/web from the API server
```

Set `POS_DB` to use a different database file, `PORT` to change the port.
