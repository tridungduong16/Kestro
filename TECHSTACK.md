# Chronos - Lightweight HTTP Scheduler

## Overview

Chronos is a lightweight scheduler service inspired by Google Cloud Scheduler.

The platform allows users to create recurring schedules that trigger HTTP endpoints at predefined intervals. Chronos focuses on simplicity, reliability, and ease of deployment while providing execution history and monitoring capabilities.

## Frontend Stack

### Framework

* Next.js 15
* React 19
* TypeScript

### UI Components

* shadcn/ui
* Radix UI

### Styling

* Tailwind CSS

### State Management

* TanStack Query

### Forms & Validation

* React Hook Form
* Zod

### Features

* Schedule Management
* Create / Edit / Delete Schedule
* Execution History
* Run Schedule Manually
* Schedule Monitoring

---

## Backend Stack

### Language

* Rust

### Web Framework

* Axum

### Async Runtime

* Tokio

### Database

* PostgreSQL

### Database Access

* SQLx

### HTTP Client

* Reqwest

### Scheduling Engine

* Tokio Background Workers
* Cron Expression Support

### Serialization

* Serde

### Logging

* Tracing
* Tracing Subscriber

### Features

* REST API
* Schedule Persistence
* Cron Expression Processing
* HTTP Endpoint Execution
* Execution Tracking
* Retry Support
* Health Checks

---

## Infrastructure

### Containerization

* Docker
* Docker Compose

### Reverse Proxy (Optional)

* Nginx

### Deployment Targets

* Linux VPS
* AWS EC2
* DigitalOcean
* Hetzner
* Kubernetes (Future)

---

## Core Components

### API Service

Responsible for:

* Schedule CRUD
* Execution Queries
* Health Endpoints

### Scheduler Worker

Responsible for:

* Detecting Due Jobs
* Triggering Executions
* Updating Next Run Time

### Execution Engine

Responsible for:

* HTTP Requests
* Timeout Handling
* Retry Logic
* Response Collection

### Database

Stores:

* Schedules
* Execution History
* System Metadata

---

## Design Principles

* Lightweight
* Self-hostable
* Docker-first
* API-centric
* Cloud Scheduler Inspired
* Minimal Operational Complexity
* Future Support for Distributed Scheduling
