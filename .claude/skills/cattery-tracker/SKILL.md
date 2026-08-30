---
name: cattery-tracker
description: Multi-tenant cattery/pet care management SaaS (web + mobile + tablet) for tracking feeding, cleaning, vet care, and health logs across multiple cats and multiple users. Use this skill whenever building, extending, or debugging any part of the Cattery Tracker system (backend, web app, or mobile/tablet app).
---

# Cattery Tracker — Product Skill

## Core Product Elements
- **Product name:** Cattery Tracker
- **Target users:** Cattery owners and individual pet owners (multi-tenant)
- **Platforms:** Web app + Mobile app (phone) + Tablet — shared backend, responsive layouts across all
- **Pricing model:** Free for now, paid subscription planned later
- **Core value:** Never miss a feeding, cleaning, or vet deadline — across any number of cats, from any device

## Tech Stack
- **Backend:** Python (FastAPI) + PostgreSQL
- **Auth:** Email + password + phone number, JWT-based sessions
- **Web app:** React (Next.js), responsive for desktop/tablet breakpoints
- **Mobile + tablet app:** React Native (Expo), responsive layout (adapts to tablet screen size), built for EAS (real push notifications, not Expo Go)
- **Hosting:** Railway (backend + database + web frontend)

## Data Model Rules
- Every table must include `user_id` for multi-tenant isolation — no user can ever see another user's data
- Core entities: User, Cat, FeedingSchedule, FeedingEvent, CleaningTask, VetRecord, WeightLog, Notification

## Reminder & Notification Logic (Detailed)

**Responsibilities:**
- Track feeding schedules per cat and mark completed/missed feedings
- Track litter/cleaning rotation tasks and rotate reminders across cleaning zones
- Track vet appointments, vaccination due dates, and medication schedules
- Calculate what's due "today" vs "upcoming" vs "overdue"

**Daily digest:**
- Sent once per day (default 8 AM, configurable per user) via in-app notification center and native push
- Summarizes: feeding times for today, cleaning tasks due today, vet/vaccination deadlines this week, any overdue items flagged clearly

**Overdue alerts:**
- Instant alert (in-app + push) if a task is overdue by more than X hours
- Threshold configurable per task type (e.g. feeding: 2 hours, cleaning: 6 hours, vet: 24 hours) — default values, user-adjustable per account

**Trigger conditions:**
- Daily digest: runs once per day at user-configured time
- Overdue check: runs periodically (e.g. every 15–30 minutes) to detect and alert on overdue tasks
- On-demand query: user can ask "what's due today?" within the app

## Your Task
When working on this project, you build and maintain:
1. **Backend API** — auth (signup/login/JWT), CRUD endpoints for cats, feeding, cleaning, vet, weight logs, and notifications
2. **Web app** — full feature parity with mobile, responsive across desktop and tablet
3. **Mobile + tablet app** — same features, responsive layout for both phone and tablet screen sizes, plus native push notifications
4. **Notification logic** — implement the reminder/notification system exactly as specified above (no Telegram/WhatsApp)

## Output Format
When implementing a feature, always:
1. State which layer you're changing (backend / web / mobile / shared)
2. Confirm multi-tenant isolation is respected (user_id checks)
3. Note any new environment variables or migrations needed
4. Flag anything that needs a decision from the user before proceeding