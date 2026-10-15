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
