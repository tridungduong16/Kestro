use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use cron::Schedule as CronSchedule;
use reqwest::{
    Client, Method,
    header::{HeaderName, HeaderValue},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, PgPool, postgres::PgPoolOptions};
use std::{env, net::SocketAddr, str::FromStr, time::Duration};
use tokio::time;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    http: Client,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "error": self.message
            })),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        match error {
            sqlx::Error::RowNotFound => ApiError::new(StatusCode::NOT_FOUND, "Schedule not found"),
            _ => ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Schedule {
    id: Uuid,
    name: String,
    target_url: String,
    method: String,
    cron_expression: String,
    headers: Value,
    payload: Option<String>,
    status: String,
    timeout_seconds: i32,
    retry_count: i32,
    next_run_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct Execution {
    id: Uuid,
    schedule_id: Uuid,
    started_at: DateTime<Utc>,
    finished_at: DateTime<Utc>,
    status: String,
    status_code: Option<i32>,
    duration_ms: i32,
    error: Option<String>,
    response_body: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSchedule {
    name: String,
    target_url: String,
    method: String,
    cron_expression: String,
    headers: Option<Value>,
    payload: Option<String>,
    status: Option<String>,
    timeout_seconds: Option<i32>,
    retry_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateSchedule {
    name: Option<String>,
    target_url: Option<String>,
    method: Option<String>,
    cron_expression: Option<String>,
    headers: Option<Value>,
    payload: Option<String>,
    status: Option<String>,
    timeout_seconds: Option<i32>,
    retry_count: Option<i32>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "chronos_api=info,tower_http=info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://chronos:chronos@localhost:5432/chronos".to_string());
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let tick_seconds = env::var("SCHEDULER_TICK_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(30);

    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState {
        pool,
        http: Client::builder()
            .user_agent("chronos-scheduler/0.1")
            .build()?,
    };

    spawn_scheduler(state.clone(), tick_seconds);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/schedules", get(list_schedules).post(create_schedule))
        .route(
            "/api/schedules/{id}",
            get(get_schedule)
                .patch(update_schedule)
                .delete(delete_schedule),
        )
        .route("/api/schedules/{id}/run", post(run_schedule))
        .route("/api/schedules/{id}/executions", get(list_executions))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let addr: SocketAddr = bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Chronos API listening on {addr}");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(HealthResponse { status: "ok" }))
}

async fn list_schedules(State(state): State<AppState>) -> Result<Json<Vec<Schedule>>, ApiError> {
    let schedules = sqlx::query_as::<_, Schedule>(
        r#"
        SELECT id, name, target_url, method, cron_expression, headers, payload, status,
               timeout_seconds, retry_count, next_run_at, created_at, updated_at
        FROM schedules
        ORDER BY created_at DESC
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(schedules))
}

async fn get_schedule(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<Schedule>, ApiError> {
    Ok(Json(load_schedule(&state.pool, id).await?))
}

async fn create_schedule(
    State(state): State<AppState>,
    Json(payload): Json<CreateSchedule>,
) -> Result<(StatusCode, Json<Schedule>), ApiError> {
    validate_url(&payload.target_url)?;
    let method = validate_method(&payload.method)?;
    let status = validate_status(payload.status.as_deref().unwrap_or("active"))?;
    let headers = normalize_headers(payload.headers)?;
    let timeout_seconds = validate_timeout(payload.timeout_seconds.unwrap_or(30))?;
    let retry_count = validate_retry_count(payload.retry_count.unwrap_or(0))?;
    let next_run_at = calculate_next_run(&payload.cron_expression)?;

    let schedule = sqlx::query_as::<_, Schedule>(
        r#"
        INSERT INTO schedules (
            name, target_url, method, cron_expression, headers, payload, status,
            timeout_seconds, retry_count, next_run_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, name, target_url, method, cron_expression, headers, payload, status,
                  timeout_seconds, retry_count, next_run_at, created_at, updated_at
        "#,
    )
    .bind(payload.name)
    .bind(payload.target_url)
    .bind(method)
    .bind(payload.cron_expression)
    .bind(headers)
    .bind(payload.payload)
    .bind(status)
    .bind(timeout_seconds)
    .bind(retry_count)
    .bind(next_run_at)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(schedule)))
}

async fn update_schedule(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateSchedule>,
) -> Result<Json<Schedule>, ApiError> {
    let existing = load_schedule(&state.pool, id).await?;

    let name = payload.name.unwrap_or(existing.name);
    let target_url = payload.target_url.unwrap_or(existing.target_url);
    let method = validate_method(payload.method.as_deref().unwrap_or(&existing.method))?;
    let cron_expression = payload.cron_expression.unwrap_or(existing.cron_expression);
    let headers = match payload.headers {
        Some(headers) => normalize_headers(Some(headers))?,
        None => existing.headers,
    };
    let status = validate_status(payload.status.as_deref().unwrap_or(&existing.status))?;
    let timeout_seconds =
        validate_timeout(payload.timeout_seconds.unwrap_or(existing.timeout_seconds))?;
    let retry_count = validate_retry_count(payload.retry_count.unwrap_or(existing.retry_count))?;

    validate_url(&target_url)?;

    let next_run_at = if status == "active" {
        calculate_next_run(&cron_expression)?
    } else {
        existing.next_run_at
    };

    let schedule = sqlx::query_as::<_, Schedule>(
        r#"
        UPDATE schedules
        SET name = $1,
            target_url = $2,
            method = $3,
            cron_expression = $4,
            headers = $5,
            payload = $6,
            status = $7,
            timeout_seconds = $8,
            retry_count = $9,
            next_run_at = $10,
            updated_at = now()
        WHERE id = $11
        RETURNING id, name, target_url, method, cron_expression, headers, payload, status,
                  timeout_seconds, retry_count, next_run_at, created_at, updated_at
        "#,
    )
    .bind(name)
    .bind(target_url)
    .bind(method)
    .bind(cron_expression)
    .bind(headers)
    .bind(payload.payload.or(existing.payload))
    .bind(status)
    .bind(timeout_seconds)
    .bind(retry_count)
    .bind(next_run_at)
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(schedule))
}

async fn delete_schedule(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM schedules WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "Schedule not found"));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn run_schedule(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<Execution>, ApiError> {
    let schedule = load_schedule(&state.pool, id).await?;
    let execution = execute_schedule(&state, &schedule).await?;

    if schedule.status == "active" {
        let next_run_at = calculate_next_run(&schedule.cron_expression)?;
        sqlx::query("UPDATE schedules SET next_run_at = $1, updated_at = now() WHERE id = $2")
            .bind(next_run_at)
            .bind(schedule.id)
            .execute(&state.pool)
            .await?;
    }

    Ok(Json(execution))
}

async fn list_executions(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<Json<Vec<Execution>>, ApiError> {
    let executions = sqlx::query_as::<_, Execution>(
        r#"
        SELECT id, schedule_id, started_at, finished_at, status, status_code, duration_ms,
               error, response_body
        FROM executions
        WHERE schedule_id = $1
        ORDER BY started_at DESC
        LIMIT 100
        "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(executions))
}

async fn load_schedule(pool: &PgPool, id: Uuid) -> Result<Schedule, ApiError> {
    let schedule = sqlx::query_as::<_, Schedule>(
        r#"
        SELECT id, name, target_url, method, cron_expression, headers, payload, status,
               timeout_seconds, retry_count, next_run_at, created_at, updated_at
        FROM schedules
        WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_one(pool)
    .await?;

    Ok(schedule)
}

fn spawn_scheduler(state: AppState, tick_seconds: u64) {
    tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(tick_seconds));

        loop {
            interval.tick().await;
            if let Err(error) = process_due_schedules(&state).await {
                error!(%error.message, "scheduler tick failed");
            }
        }
    });
}

async fn process_due_schedules(state: &AppState) -> Result<(), ApiError> {
    let due_schedules = sqlx::query_as::<_, Schedule>(
        r#"
        SELECT id, name, target_url, method, cron_expression, headers, payload, status,
               timeout_seconds, retry_count, next_run_at, created_at, updated_at
        FROM schedules
        WHERE status = 'active' AND next_run_at <= now()
        ORDER BY next_run_at ASC
        LIMIT 25
        "#,
    )
    .fetch_all(&state.pool)
    .await?;

    for schedule in due_schedules {
        let next_run_at = calculate_next_run(&schedule.cron_expression)?;
        let update = sqlx::query(
            r#"
            UPDATE schedules
            SET next_run_at = $1, updated_at = now()
            WHERE id = $2 AND next_run_at = $3
            "#,
        )
        .bind(next_run_at)
        .bind(schedule.id)
        .bind(schedule.next_run_at)
        .execute(&state.pool)
        .await?;

        if update.rows_affected() == 0 {
            continue;
        }

        let worker_state = state.clone();
        tokio::spawn(async move {
            if let Err(error) = execute_schedule(&worker_state, &schedule).await {
                error!(%error.message, schedule_id = %schedule.id, "execution failed to persist");
            }
        });
    }

    Ok(())
}

async fn execute_schedule(state: &AppState, schedule: &Schedule) -> Result<Execution, ApiError> {
    let started_at = Utc::now();
    let timer = std::time::Instant::now();
    let mut final_status = "failed".to_string();
    let mut status_code = None;
    let mut response_body = None;
    let mut error_message = None;

    for attempt in 0..=schedule.retry_count {
        match send_http_request(state, schedule).await {
            Ok((code, body)) => {
                status_code = Some(code as i32);
                response_body = Some(truncate(&body, 2_000));

                if (200..=299).contains(&code) {
                    final_status = "success".to_string();
                    error_message = None;
                    break;
                }

                error_message = Some(format!("Endpoint returned HTTP {code}"));
            }
            Err(error) => {
                error_message = Some(error);
            }
        }

        if attempt < schedule.retry_count {
            time::sleep(Duration::from_millis(250 * (attempt as u64 + 1))).await;
        }
    }

    let finished_at = Utc::now();
    let duration_ms = timer.elapsed().as_millis().min(i32::MAX as u128) as i32;

    let execution = sqlx::query_as::<_, Execution>(
        r#"
        INSERT INTO executions (
            schedule_id, started_at, finished_at, status, status_code, duration_ms,
            error, response_body
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, schedule_id, started_at, finished_at, status, status_code,
                  duration_ms, error, response_body
        "#,
    )
    .bind(schedule.id)
    .bind(started_at)
    .bind(finished_at)
    .bind(final_status)
    .bind(status_code)
    .bind(duration_ms)
    .bind(error_message)
    .bind(response_body)
    .fetch_one(&state.pool)
    .await?;

    Ok(execution)
}

async fn send_http_request(state: &AppState, schedule: &Schedule) -> Result<(u16, String), String> {
    let method = Method::from_bytes(schedule.method.as_bytes())
        .map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let mut request = state
        .http
        .request(method, &schedule.target_url)
        .timeout(Duration::from_secs(schedule.timeout_seconds as u64));

    if let Some(headers) = schedule.headers.as_object() {
        for (key, value) in headers {
            let Some(value) = value.as_str() else {
                return Err(format!("Header {key} must be a string"));
            };

            let header_name = HeaderName::from_bytes(key.as_bytes())
                .map_err(|error| format!("Invalid header name {key}: {error}"))?;
            let header_value = HeaderValue::from_str(value)
                .map_err(|error| format!("Invalid header value for {key}: {error}"))?;
            request = request.header(header_name, header_value);
        }
    }

    if let Some(payload) = &schedule.payload {
        if !payload.trim().is_empty() {
            request = request.body(payload.clone());
        }
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("Request failed: {error}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();

    Ok((status, body))
}

fn calculate_next_run(expression: &str) -> Result<DateTime<Utc>, ApiError> {
    let normalized = normalize_cron_expression(expression);
    let schedule = CronSchedule::from_str(&normalized).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Invalid cron expression: {error}"),
        )
    })?;

    schedule
        .upcoming(Utc)
        .next()
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "Cron expression has no future run"))
}

fn normalize_cron_expression(expression: &str) -> String {
    let parts = expression.split_whitespace().count();
    if parts == 5 {
        format!("0 {expression}")
    } else {
        expression.to_string()
    }
}

fn normalize_headers(headers: Option<Value>) -> Result<Value, ApiError> {
    match headers {
        Some(value @ Value::Object(_)) => Ok(value),
        Some(_) => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Headers must be a JSON object",
        )),
        None => Ok(json!({})),
    }
}

fn validate_method(method: &str) -> Result<String, ApiError> {
    let normalized = method.trim().to_uppercase();
    Method::from_bytes(normalized.as_bytes()).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Invalid HTTP method: {error}"),
        )
    })?;
    Ok(normalized)
}

fn validate_status(status: &str) -> Result<String, ApiError> {
    match status {
        "active" | "paused" => Ok(status.to_string()),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Status must be active or paused",
        )),
    }
}

fn validate_timeout(timeout_seconds: i32) -> Result<i32, ApiError> {
    if (1..=120).contains(&timeout_seconds) {
        Ok(timeout_seconds)
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Timeout must be between 1 and 120 seconds",
        ))
    }
}

fn validate_retry_count(retry_count: i32) -> Result<i32, ApiError> {
    if (0..=5).contains(&retry_count) {
        Ok(retry_count)
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Retry count must be between 0 and 5",
        ))
    }
}

fn validate_url(target_url: &str) -> Result<(), ApiError> {
    let parsed = url::Url::parse(target_url).map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Invalid target URL: {error}"),
        )
    })?;

    match parsed.scheme() {
        "http" | "https" => Ok(()),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "Target URL must use http or https",
        )),
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
