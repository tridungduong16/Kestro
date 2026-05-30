# UI/UX Overview

Chronos follows a simple and focused user experience inspired by Google Cloud Scheduler.

The interface is designed around a single core concept: scheduling recurring HTTP requests.

## Design Principles

* Minimal and intuitive
* Fast schedule creation
* Clear execution visibility
* Low learning curve
* No-code configuration

## Main Screens

### Schedule List

The primary dashboard displays all schedules in a table view, including:

* Schedule Name
* Target Endpoint
* Schedule Frequency
* Next Run Time
* Status (Active / Paused)

Users can:

* Create a schedule
* Run a schedule immediately
* Edit a schedule
* Pause or resume a schedule
* Delete a schedule

### Create Schedule

A simple form allowing users to configure:

* Schedule Name
* Frequency or Cron Expression
* HTTP Method
* Target URL
* Request Headers (Optional)
* Request Payload (Optional)

The creation flow is designed to be completed within seconds.

### Schedule Details

Provides detailed information about a schedule, including:

* Configuration
* Next Execution Time
* Recent Execution History
* Success / Failure Status

### Execution History

Displays a chronological list of executions with:

* Timestamp
* Execution Status
* Duration
* HTTP Response Code
* Error Details (if any)

## Visual Style

* Clean and modern interface
* Minimal dashboard layout
* Dark mode support
* Responsive design
* Developer-focused experience

The overall experience prioritizes simplicity and operational visibility over complex workflow configuration.
