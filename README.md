# VitalCore

VitalCore is a single-user wellness planner built with HTML, CSS, vanilla JavaScript, and an Express backend. The backend persists the profile, weight check-ins, daily schedule completion, and meal-photo review results in `data/db.json`, which is created when the app is first run and excluded from Git.

## Run locally

Requirements: Node.js 18 or newer.

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Use `npm test` to run the API tests.

## API

- `GET /api/health` — server status
- `GET /api/state` — profile, weight logs, and task check-offs
- `PUT /api/profile` — validate and save the profile
- `POST /api/weights` — add a dated weight entry
- `DELETE /api/weights/:id` — remove one entry
- `DELETE /api/weights` — clear all weight entries
- `PUT /api/tasks` — save a dated schedule check-off
- `DELETE /api/tasks/:date` — reset one day's check-offs
- `POST /api/meals/verify-photo` — inspect a meal photo's metadata and save a review result (JPEG, PNG, or WebP; 10 MB maximum)

When the API is unreachable, the app falls back to browser `localStorage`. Changes made in that mode are saved to that browser and synced to the server on a later successful connection. Avoid editing the same data in multiple browsers while offline.

The JSON-file backend is intended for local development and a single user. It does not provide accounts or access controls. Do not expose it publicly or enter sensitive health data unless you add authentication and a production database. Vercel's serverless filesystem is not persistent; use a persistent hosting service or database before deploying this backend.

Meal-photo review stores metadata findings only; image bytes are discarded after inspection. The camera capture attribute is only a browser hint. EXIF data, filenames, and embedded markers can be missing or altered, so the review can flag clues but cannot prove that a photo is fresh, camera-captured, or authentic. A missing camera tag is not by itself evidence of AI generation.

Calculations and schedule content are estimates for general wellness planning, not medical advice.
