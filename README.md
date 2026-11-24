# PTI Shift Reports

Fleet and driver analytics for Petrol Transport Inc., built on the Samsara API.

## What it does (phase 1)

- Overview: totals, hours worked by day, hours by driver, shifts over a limit
- Reports: Shifts, Stops, Hours by day, Driver totals, each with search, sorting and CSV download
- Filters: period, driver, truck, start yard, over-a-limit only
- Shift detail: click any shift to see its time bar and stops in order
- Connection check: confirms the Samsara API key, permissions and yard names

## Secrets (set in Replit under Secrets, never in the code)

| Name | What it is |
| --- | --- |
| `SAMSARA_API_TOKEN` | Read-only Samsara API key. Needs read access to Vehicles, Drivers, Vehicle Trips, Addresses and ELD Hours of Service. |
| `APP_PASSWORD` | The shared office password. Live data stays locked until this is set. |
| `SESSION_SECRET` | Optional. Any long random text. |
| `YARD_NAMES` | Optional. Only if yard names in Samsara change. Format: `Samsara name=Shown name; ...` |

With no `SAMSARA_API_TOKEN` the app shows two example shifts so the screens can be checked.

## Run

    npm install
    npm start      # http://localhost:3000
    npm test       # checks the shift rules against two verified Nov 23, 2026 shifts

## Layout

- `server.js` web server, sign-in, API
- `lib/samsara.js` Samsara API client (read-only)
- `lib/reports.js` loads data and runs the shift rules
- `public/core.js` the shift rules (shared by server, browser and tests)
- `public/` the pages
