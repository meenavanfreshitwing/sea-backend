# Meenavan Fresh — Backend API

Fastify + MongoDB API used by the customer website, the mobile app, the admin panel and the delivery panel.
Images are stored in Cloudflare R2; payments go through Razorpay.

## Requirements

- Node.js 20+
- MongoDB 6+ (local or Atlas)
- `mongodump` on `PATH` (only for `npm run backup`)

## Setup

```bash
npm install
cp .env.example .env        # then fill in the values
npm run create-admin -- admin@example.com 'StrongPassword' "Admin"
npm run dev                 # or: npm start
```

The API listens on `http://localhost:5000` (`PORT`). Health check: `GET /api/test`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the API |
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm run create-admin -- <email> <password> [name]` | Create an admin, or reset an existing user's password and make them admin |
| `npm run backup` | `mongodump` the database and send it to `BACKUP_API_URL` |
| `npm test` | Booking rule tests (`node --test`) |
| `npm run fix-indexes` | Drop duplicate `users` indexes (one-off maintenance) |

## Project structure

```
app.js                 entry point: plugins, CORS, route registration
config/                env loading, MongoDB connection
controllers/           request handlers (one file per area)
middleware/            R2 upload + image optimisation
models/                Mongoose schemas
routes/                route definitions (all mounted under /api)
services/              email, SMS, backup
scripts/               CLI utilities
data/                  Karaikudi / Pudukkottai ward + street lists
assets/fonts/          Tamil font used in PDF receipts
```

## API areas (all under `/api`)

| Area | Prefix | Used by |
|---|---|---|
| Auth (OTP + admin login) | `/auth` | website, app, admin |
| Products, categories | `/products`, `/categories` | all |
| Cart | `/cart` | website, app |
| Orders + PDF receipts | `/orders`, `/admin/orders` | website, app, admin |
| Payments (Razorpay) | `/payments` | website, app |
| Delivery boys | `/delivery`, `/admin/delivery-boys` | delivery panel, admin |
| Wards | `/wards`, `/admin/wards` | website, app, admin |
| Settings, stats, users | `/settings`, `/admin/settings`, `/stats`, `/admin/users` | admin, website |
| Blogs | `/blogs` | website, admin |
| Delivery booking calendar | `/booking`, `/admin/booking` | website, app, admin |
| Content pages | `/terms`, `/privacy`, `/shipping`, `/returns`, `/contacts` | all |

### Delivery booking calendar

Every order carries a `deliveryDate` (`YYYY-MM-DD`, India time) and, when time slots are enabled,
a `deliverySlot`. Rules (enforced in `services/bookingService.js`, editable in Admin → Booking Calendar):

- No same-day orders; past dates are closed.
- Orders for date D close at the **cutoff time** (default 17:00) on the day before D.
  A single date can have its own cutoff.
- Admin can block a whole date or individual slots, with a reason and a customer message,
  and publish it as a notice (`GET /api/booking/notices`).
- `maxAdvanceDays` (default 30) limits how far ahead customers can book.
- Checked when the order is created and again before a Razorpay payment starts. A payment that
  completes after the date was blocked is never rejected; the order gets `bookingReview.required`.
- Blocking a date never cancels existing orders: review them at
  `GET /api/admin/booking/dates/:date/orders` and move them with `PATCH /api/admin/orders/:id/delivery-date`.
- Clients that send no `deliveryDate` (older app builds) get the earliest open date.

`npm test` runs the booking rule tests.

### Razorpay webhook

Point the Razorpay dashboard webhook at `POST {API_URL}/api/payments/razorpay-webhook`
and set the same secret in `RAZORPAY_WEBHOOK_SECRET`. The Razorpay key id/secret themselves are
entered in **Admin panel → Settings**.

## Security notes

- `POST /api/auth/create-admin` only works while no admin exists; afterwards an admin token is required
  (or use `npm run create-admin`).
- `PUT /api/orders/payment-success|payment-failed` are admin-only manual overrides. Customer payments
  are confirmed by `/payments/verify-payment` and the webhook, both of which check Razorpay signatures.
- Never commit `.env`. Use a long random `JWT_SECRET` in production.

## Location-wise pricing

Prices can differ per delivery location (e.g. Trichy vs Karaikudi). A location is a list of pincodes,
not the government district. Packs with no price for a location use their default price.

**Launch order:** add locations + pincodes and set prices in the admin panel → set
`LOCATION_PRICING_ENABLED=true` → release the new app/website → optionally `LOCATION_REQUIRED_FOR_ORDERS=true`.

| Endpoint | Who | What |
|---|---|---|
| `GET /locations` | public | Active locations for the "Set your location" screen |
| `GET /locations/resolve?pincode=630001` | public | Location serving a pincode, or `404 NOT_SERVICEABLE` |
| `GET/PUT /auth/location` `{ pincode, place }` | customer | Saved location (also in `GET /auth/profile` as `savedLocation`) |
| `GET/POST /admin/locations`, `PUT/DELETE /admin/locations/:id` | admin | Manage locations and their pincodes |
| `GET /admin/locations/:id/prices` | admin | Every product & pack: default price + this location's price |
| `PUT /admin/locations/:id/prices` `{ items: [{ productId, variantId?, price?, originalPrice?, isAvailable?, clear? }] }` | admin | Bulk price update for one location |
| `GET /app/version-check?platform=android&version=1.4.0` | public | `forceUpdate` when below `MIN_APP_VERSION_*` |

The website/app send the selected location with product and cart calls as `?location=<slug>`
or the `X-Location` header (and `location` in the order body). Product create/update also accept
`locationPrices` on each variant and on the product.

At checkout the **shipping pincode decides the price**; prices sent by the app are ignored.
Order errors: `NOT_SERVICEABLE`, `LOCATION_MISMATCH` (returns the address's `location` — switch to it,
reload the cart, retry), `NOT_AVAILABLE_IN_LOCATION`, `APP_UPDATE_REQUIRED`.

## Add-ons (masala etc.)

Admin creates add-on categories (Marination, Curry Masala, Ready-to-Cook Kits…) and add-ons
(photo, name, description, category, price, stock, on/off). At checkout, when the cart has fish,
customers see **every** add-on that is ON, in a category that is ON, with stock > 0.

| Endpoint | Who | What |
|---|---|---|
| `GET /addons` | public | Add-ons to show at checkout, grouped by category |
| `PUT /cart/addons` `{ addonId, quantity, guestId? }` | customer | Set an add-on's quantity in the cart (0 removes). Cart must have fish (`CART_EMPTY`) |
| `GET/POST /admin/addon-categories`, `PUT/DELETE /admin/addon-categories/:id` | admin | Categories (a category with add-ons can't be deleted) |
| `GET /admin/addons`, `POST /admin/addons`, `PUT/DELETE /admin/addons/:id` | admin | Add-ons; create/update are multipart with an `image` file (`deleteImage=true` removes it) |

Cart responses include `addons` and `addonsTotal`; `totalPrice` includes add-ons. `GET /cart` drops add-ons
the admin turned off or that ran out (their names come back in `removedItems`) and refreshes prices.
Orders take add-ons from the cart (or `addons: [{ addon, quantity }]` for Buy Now), price them from the
database, and save `addons` + `addonsAmount` on the order. Errors: `ADDON_UNAVAILABLE`, `ADDON_OUT_OF_STOCK`.
Add-on stock goes down with fish stock (COD at order, online on payment) and comes back on cancel.
