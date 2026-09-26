# Medical IMS

A lightweight inventory management system for medical warehouses, built with
Node.js, Express, and PostgreSQL. Tracks items, lot-level stock with expiry
dates, and stock movements (receive/dispatch), with low-stock and
expiring-soon alerts.

## Tech Stack

- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL 16
- **Frontend:** Static HTML/JS (served from `public/`)
- **Containerization:** Docker & Docker Compose

## Features

- Item catalog with SKU, category, unit, and minimum stock level
- Lot tracking with expiry dates and FEFO (first-expiry-first-out) dispatch
- Receive and dispatch stock with full transaction history
- Dashboard stats: total items, units in stock, low-stock count, expiring-soon count
- Low-stock and expiring-soon alerts

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### 1. Build the images

From the project root (where `Dockerfile` and `docker-compose.yml` live):

```bash
docker compose build
```

Rebuild without cache after changing code:

```bash
docker compose build --no-cache
```

### 2. Start the containers

Detached mode (runs in the background):

```bash
docker compose up -d
```

Or attached, to watch logs live:

```bash
docker compose up
```

Then open **http://localhost:3000**.

### 3. Stop the containers

Keep data volumes intact:

```bash
docker compose down
```

Also remove volumes (⚠️ wipes PostgreSQL data):

```bash
docker compose down -v
```

### 4. Restart the containers

```bash
docker compose restart
```

## Configuration

The app container reads its database connection from environment variables
(see `docker-compose.yml`):

| Variable      | Default        | Description         |
|---------------|----------------|----------------------|
| `PGHOST`      | `localhost`    | PostgreSQL host      |
| `PGPORT`      | `5432`         | PostgreSQL port      |
| `PGUSER`      | `postgres`     | PostgreSQL user      |
| `PGPASSWORD`  | `postgres`     | PostgreSQL password  |
| `PGDATABASE`  | `medwarehouse` | PostgreSQL database  |
| `PORT`        | `3000`         | App HTTP port        |

## API Overview

| Method | Endpoint             | Description                          |
|--------|----------------------|---------------------------------------|
| GET    | `/api/health`         | Health check                          |
| GET    | `/api/stats`          | Dashboard stats                       |
| GET    | `/api/items`          | List items (supports `?search=`)      |
| POST   | `/api/items`          | Create or update an item              |
| POST   | `/api/receive`        | Receive stock into a lot              |
| POST   | `/api/dispatch`       | Dispatch stock (FEFO)                 |
| GET    | `/api/transactions`   | Recent stock transactions             |
| GET    | `/api/alerts`         | Low-stock / expiring-soon alerts      |

## Project Structure

```
.
├── Dockerfile
├── docker-compose.yml
├── package.json
├── server.js          # Express app + PostgreSQL schema/queries
└── public/            # Static frontend (dashboard, items, receive, dispatch)
```
