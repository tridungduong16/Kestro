use axum::{
    Json, Router,
    extract::{Multipart, Path, State},
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
use serde_json::{Map, Value, json};
use sqlx::{FromRow, MySqlPool, mysql::MySqlPoolOptions};
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
    pool: MySqlPool,
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
#[serde(rename_all = "camelCase")]
struct BrunoImportPreview {
    source: BrunoImportSource,
    schedule: BrunoScheduleDraft,
    warnings: Vec<String>,
    unsupported_blocks: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrunoImportSource {
    file_name: Option<String>,
    format: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrunoScheduleDraft {
    name: String,
    target_url: String,
    method: String,
    cron_expression: String,
    headers: Value,
    payload: Option<String>,
    status: String,
    timeout_seconds: i32,
    retry_count: i32,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_api_env();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kestro_api=info,tower_http=info".into()),
        )
        .init();

    let database_url = database_url_from_env()?;
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let tick_seconds = env::var("SCHEDULER_TICK_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(30);

    let pool = MySqlPoolOptions::new()
        .max_connections(10)
        .after_connect(|connection, _meta| {
            Box::pin(async move {
                sqlx::query("SET time_zone = '+00:00'")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    let state = AppState {
        pool,
        http: Client::builder()
            .user_agent("kestro-scheduler/0.1")
            .build()?,
    };

    spawn_scheduler(state.clone(), tick_seconds);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/imports/bruno/request", post(preview_bruno_request))
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
    info!("Kestro API listening on {addr}");
    axum::serve(listener, app).await?;

    Ok(())
}

fn load_api_env() {
    for path in ["apps/api/.env", ".env"] {
        if dotenvy::from_filename(path).is_ok() {
            break;
        }
    }
}

fn database_url_from_env() -> anyhow::Result<String> {
    if let Some(database_url) = env::var("DATABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(database_url);
    }

    let host = env_var_or_default("DB_HOST", "localhost");
    let port = env_var_or_default("DB_PORT", "3306");
    let user = env_var_or_default("DB_USER", "kestro");
    let password = env::var("DB_PASSWORD")
        .or_else(|_| env::var("DB_PASS"))
        .unwrap_or_else(|_| "kestro".to_string());
    let database = env_var_or_default("DB_NAME", "kestro");

    let port = port
        .parse::<u16>()
        .map_err(|_| anyhow::anyhow!("DB_PORT must be a valid TCP port"))?;
    let mut url = url::Url::parse("mysql://localhost")?;
    url.set_host(Some(&host))
        .map_err(|_| anyhow::anyhow!("DB_HOST must be a valid hostname or IP address"))?;
    url.set_port(Some(port))
        .map_err(|_| anyhow::anyhow!("DB_PORT must be a valid TCP port"))?;
    url.set_username(&user)
        .map_err(|_| anyhow::anyhow!("DB_USER must be valid for a database URL"))?;
    url.set_password(Some(&password))
        .map_err(|_| anyhow::anyhow!("DB_PASSWORD/DB_PASS must be valid for a database URL"))?;
    url.set_path(&database);

    Ok(url.to_string())
}

fn env_var_or_default(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.pool)
        .await?;

    Ok(Json(HealthResponse { status: "ok" }))
}

async fn preview_bruno_request(
    mut multipart: Multipart,
) -> Result<Json<BrunoImportPreview>, ApiError> {
    const MAX_BRU_BYTES: usize = 1_048_576;

    let mut file_name = None;
    let mut content = None;

    while let Some(field) = multipart.next_field().await.map_err(|error| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            format!("Invalid multipart payload: {error}"),
        )
    })? {
        let field_name = field.name().unwrap_or_default().to_string();

        if field_name != "file" && field_name != "content" {
            continue;
        }

        if file_name.is_none() {
            file_name = field.file_name().map(ToString::to_string);
        }

        let bytes = field.bytes().await.map_err(|error| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("Unable to read Bruno import field: {error}"),
            )
        })?;

        if bytes.len() > MAX_BRU_BYTES {
            return Err(ApiError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Bruno request file must be 1 MiB or smaller",
            ));
        }

        let text = String::from_utf8(bytes.to_vec()).map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "Bruno request file must be valid UTF-8 text",
            )
        })?;

        content = Some(text);
        break;
    }

    let content = content.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Upload a .bru file in field 'file' or raw .bru text in field 'content'",
        )
    })?;

    Ok(Json(parse_bruno_request(&content, file_name.as_deref())?))
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
    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO schedules (
            id, name, target_url, method, cron_expression, headers, payload, status,
            timeout_seconds, retry_count, next_run_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
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
    .execute(&state.pool)
    .await?;

    let schedule = load_schedule(&state.pool, id).await?;

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

    sqlx::query(
        r#"
        UPDATE schedules
        SET name = ?,
            target_url = ?,
            method = ?,
            cron_expression = ?,
            headers = ?,
            payload = ?,
            status = ?,
            timeout_seconds = ?,
            retry_count = ?,
            next_run_at = ?,
            updated_at = UTC_TIMESTAMP(6)
        WHERE id = ?
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
    .execute(&state.pool)
    .await?;

    let schedule = load_schedule(&state.pool, id).await?;

    Ok(Json(schedule))
}

async fn delete_schedule(
    Path(id): Path<Uuid>,
    State(state): State<AppState>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM schedules WHERE id = ?")
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
        sqlx::query(
            "UPDATE schedules SET next_run_at = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?",
        )
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
        WHERE schedule_id = ?
        ORDER BY started_at DESC
        LIMIT 100
        "#,
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(executions))
}

async fn load_schedule(pool: &MySqlPool, id: Uuid) -> Result<Schedule, ApiError> {
    let schedule = sqlx::query_as::<_, Schedule>(
        r#"
        SELECT id, name, target_url, method, cron_expression, headers, payload, status,
               timeout_seconds, retry_count, next_run_at, created_at, updated_at
        FROM schedules
        WHERE id = ?
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
        WHERE status = 'active' AND next_run_at <= UTC_TIMESTAMP(6)
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
            SET next_run_at = ?, updated_at = UTC_TIMESTAMP(6)
            WHERE id = ? AND next_run_at = ?
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
    let id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO executions (
            id, schedule_id, started_at, finished_at, status, status_code, duration_ms,
            error, response_body
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(id)
    .bind(schedule.id)
    .bind(started_at)
    .bind(finished_at)
    .bind(final_status)
    .bind(status_code)
    .bind(duration_ms)
    .bind(error_message)
    .bind(response_body)
    .execute(&state.pool)
    .await?;

    let execution = sqlx::query_as::<_, Execution>(
        r#"
        SELECT id, schedule_id, started_at, finished_at, status, status_code,
               duration_ms, error, response_body
        FROM executions
        WHERE id = ?
        "#,
    )
    .bind(id)
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

fn parse_bruno_request(
    content: &str,
    file_name: Option<&str>,
) -> Result<BrunoImportPreview, ApiError> {
    let blocks = parse_bru_blocks(content)?;
    if blocks.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "No Bruno blocks found in request file",
        ));
    }

    let mut warnings = vec![
        "Cron expression is not part of Bruno request files; defaulted to hourly.".to_string(),
        "Imported schedules default to paused until reviewed.".to_string(),
    ];
    let mut unsupported_blocks = Vec::new();
    let mut name = file_name
        .and_then(file_stem)
        .unwrap_or_else(|| "Imported Bruno request".to_string());
    let mut method = None;
    let mut target_url = None;
    let mut headers = Map::new();
    let mut payload = None;
    let mut query_params = Vec::new();

    for block in &blocks {
        match block.name.as_str() {
            "meta" => {
                if let Some((_, value)) = parse_key_values(&block.content)
                    .into_iter()
                    .find(|(key, _)| key == "name")
                {
                    if !value.trim().is_empty() {
                        name = value;
                    }
                }
            }
            "http" => {
                let mut values = parse_key_values(&block.content);
                if method.is_none() {
                    method = take_key_value(&mut values, "method");
                }
                if target_url.is_none() {
                    target_url = take_key_value(&mut values, "url");
                }
                if values
                    .iter()
                    .any(|(key, value)| key == "auth" && !value.eq_ignore_ascii_case("none"))
                {
                    unsupported_blocks.push("auth".to_string());
                }

                for nested in parse_bru_blocks_lossy(&block.content) {
                    apply_import_block(
                        &nested,
                        &mut headers,
                        &mut payload,
                        &mut query_params,
                        &mut unsupported_blocks,
                    );
                }
            }
            name if is_http_method(name) => {
                method = Some(name.to_uppercase());
                let values = parse_key_values(&block.content);
                if let Some((_, value)) = values.iter().find(|(key, _)| key == "url") {
                    target_url = Some(value.clone());
                }
                if values
                    .iter()
                    .any(|(key, value)| key == "auth" && !value.eq_ignore_ascii_case("none"))
                {
                    unsupported_blocks.push("auth".to_string());
                }
            }
            _ => apply_import_block(
                block,
                &mut headers,
                &mut payload,
                &mut query_params,
                &mut unsupported_blocks,
            ),
        }
    }

    let method = method.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Bruno request must include an HTTP method block or http.method",
        )
    })?;
    let method = validate_method(&method)?;

    let mut target_url = target_url.ok_or_else(|| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "Bruno request must include a target URL",
        )
    })?;
    if !query_params.is_empty() {
        target_url = append_query_params(&target_url, &query_params);
    }

    if target_url.contains("{{") {
        warnings.push(
            "Target URL contains Bruno variables; resolve them before creating the schedule."
                .to_string(),
        );
    }

    if headers
        .values()
        .any(|value| value.as_str().is_some_and(|header| header.contains("{{")))
    {
        warnings.push(
            "One or more headers contain Bruno variables; resolve them before creating the schedule."
                .to_string(),
        );
    }

    dedupe_strings(&mut unsupported_blocks);
    if !unsupported_blocks.is_empty() {
        warnings.push(
            "Scripts, tests, auth, and collection-level settings are not executed during import."
                .to_string(),
        );
    }

    Ok(BrunoImportPreview {
        source: BrunoImportSource {
            file_name: file_name.map(ToString::to_string),
            format: "bru",
        },
        schedule: BrunoScheduleDraft {
            name,
            target_url,
            method,
            cron_expression: "0 * * * *".to_string(),
            headers: Value::Object(headers),
            payload,
            status: "paused".to_string(),
            timeout_seconds: 30,
            retry_count: 0,
        },
        warnings,
        unsupported_blocks,
    })
}

fn apply_import_block(
    block: &BruBlock,
    headers: &mut Map<String, Value>,
    payload: &mut Option<String>,
    query_params: &mut Vec<(String, String)>,
    unsupported_blocks: &mut Vec<String>,
) {
    match block.name.as_str() {
        "headers" => {
            for (key, value) in parse_key_values(&block.content) {
                headers.insert(key, Value::String(value));
            }
        }
        "query" => {
            query_params.extend(parse_key_values(&block.content));
        }
        "params" if block.qualifier.as_deref() == Some("query") => {
            query_params.extend(parse_key_values(&block.content));
        }
        "body" => {
            let imported = extract_body_payload(block);
            if imported.as_deref().is_some_and(|value| !value.is_empty()) {
                *payload = imported;
            }
        }
        "auth"
        | "assert"
        | "tests"
        | "vars"
        | "cookies"
        | "docs"
        | "script"
        | "pre-request-script"
        | "post-response-script" => {
            unsupported_blocks.push(block.label());
        }
        _ => {
            if block.name.contains("script")
                || block.name.contains("test")
                || block.name.contains("auth")
                || block.name.contains("assert")
            {
                unsupported_blocks.push(block.label());
            }
        }
    }
}

fn extract_body_payload(block: &BruBlock) -> Option<String> {
    if let Some(value) = extract_triple_quoted_value(&block.content, "data") {
        return Some(value);
    }

    let value = block.content.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn append_query_params(target_url: &str, params: &[(String, String)]) -> String {
    let query = params
        .iter()
        .filter(|(key, _)| !key.trim().is_empty())
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");

    if query.is_empty() {
        return target_url.to_string();
    }

    let separator = if target_url.contains('?') {
        if target_url.ends_with('?') || target_url.ends_with('&') {
            ""
        } else {
            "&"
        }
    } else {
        "?"
    };

    format!("{target_url}{separator}{query}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BruBlock {
    name: String,
    qualifier: Option<String>,
    content: String,
}

impl BruBlock {
    fn label(&self) -> String {
        match &self.qualifier {
            Some(qualifier) => format!("{}:{qualifier}", self.name),
            None => self.name.clone(),
        }
    }
}

fn parse_bru_blocks_lossy(content: &str) -> Vec<BruBlock> {
    parse_bru_blocks(content).unwrap_or_default()
}

fn parse_bru_blocks(content: &str) -> Result<Vec<BruBlock>, ApiError> {
    let mut blocks = Vec::new();
    let mut index = 0;
    let bytes = content.as_bytes();

    while index < bytes.len() {
        index = skip_ws_and_comments(content, index);
        if index >= bytes.len() {
            break;
        }

        let header_start = index;
        while index < bytes.len() && bytes[index] != b'{' {
            index += 1;
        }

        if index >= bytes.len() {
            break;
        }

        let raw_header = content[header_start..index]
            .lines()
            .last()
            .unwrap_or_default()
            .trim();
        if raw_header.is_empty() {
            index += 1;
            continue;
        }

        let (name, qualifier) = parse_block_header(raw_header);
        if name.is_empty() {
            index += 1;
            continue;
        }

        let (content_end, next_index) = find_block_end(content, index).ok_or_else(|| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                format!("Unclosed Bruno block '{raw_header}'"),
            )
        })?;

        blocks.push(BruBlock {
            name,
            qualifier,
            content: content[index + 1..content_end].to_string(),
        });
        index = next_index;
    }

    Ok(blocks)
}

fn parse_block_header(header: &str) -> (String, Option<String>) {
    let normalized = header.trim().trim_end_matches(':').trim();
    let mut parts = normalized.splitn(2, ':');
    let name = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
    let qualifier = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    (name, qualifier)
}

fn find_block_end(content: &str, open_brace: usize) -> Option<(usize, usize)> {
    let bytes = content.as_bytes();
    let mut index = open_brace + 1;
    let mut depth = 1usize;
    let mut quote = None;
    let mut in_triple_single = false;
    let mut in_triple_double = false;

    while index < bytes.len() {
        if in_triple_single {
            if bytes.get(index..index + 3) == Some(b"'''") {
                in_triple_single = false;
                index += 3;
            } else {
                index += 1;
            }
            continue;
        }

        if in_triple_double {
            if bytes.get(index..index + 3) == Some(b"\"\"\"") {
                in_triple_double = false;
                index += 3;
            } else {
                index += 1;
            }
            continue;
        }

        if let Some(active_quote) = quote {
            if bytes[index] == b'\\' {
                index += 2;
                continue;
            }
            if bytes[index] == active_quote {
                quote = None;
            }
            index += 1;
            continue;
        }

        if bytes.get(index..index + 3) == Some(b"'''") {
            in_triple_single = true;
            index += 3;
            continue;
        }

        if bytes.get(index..index + 3) == Some(b"\"\"\"") {
            in_triple_double = true;
            index += 3;
            continue;
        }

        match bytes[index] {
            b'\'' | b'"' => {
                quote = Some(bytes[index]);
                index += 1;
            }
            b'{' => {
                depth += 1;
                index += 1;
            }
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((index, index + 1));
                }
                index += 1;
            }
            _ => index += 1,
        }
    }

    None
}

fn skip_ws_and_comments(content: &str, mut index: usize) -> usize {
    let bytes = content.as_bytes();

    loop {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }

        if bytes.get(index) == Some(&b'#') {
            index = skip_line(bytes, index);
            continue;
        }

        if bytes.get(index..index + 2) == Some(b"//") {
            index = skip_line(bytes, index);
            continue;
        }

        return index;
    }
}

fn skip_line(bytes: &[u8], mut index: usize) -> usize {
    while index < bytes.len() && bytes[index] != b'\n' {
        index += 1;
    }
    index
}

fn parse_key_values(content: &str) -> Vec<(String, String)> {
    let mut values = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed == "{"
            || trimmed == "}"
            || trimmed.starts_with('#')
            || trimmed.starts_with("//")
        {
            continue;
        }

        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() || key.starts_with('~') {
            continue;
        }

        let value = clean_bru_scalar(value);
        if value == "{" {
            continue;
        }

        values.push((key.to_string(), value));
    }

    values
}

fn take_key_value(values: &mut Vec<(String, String)>, key: &str) -> Option<String> {
    values
        .iter()
        .position(|(candidate, _)| candidate == key)
        .map(|index| values.remove(index).1)
}

fn clean_bru_scalar(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches(',').trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }

    trimmed.to_string()
}

fn extract_triple_quoted_value(content: &str, key: &str) -> Option<String> {
    let needle = format!("{key}:");
    let start = content.find(&needle)? + needle.len();
    let rest = content[start..].trim_start();

    if let Some(rest) = rest.strip_prefix("'''") {
        let end = rest.find("'''")?;
        return Some(rest[..end].trim().to_string());
    }

    if let Some(rest) = rest.strip_prefix("\"\"\"") {
        let end = rest.find("\"\"\"")?;
        return Some(rest[..end].trim().to_string());
    }

    None
}

fn is_http_method(value: &str) -> bool {
    matches!(
        value,
        "get" | "post" | "put" | "patch" | "delete" | "head" | "options"
    )
}

fn file_stem(file_name: &str) -> Option<String> {
    std::path::Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(ToString::to_string)
}

fn dedupe_strings(values: &mut Vec<String>) {
    let mut deduped = Vec::new();
    for value in values.drain(..) {
        if !deduped.contains(&value) {
            deduped.push(value);
        }
    }
    *values = deduped;
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_classic_bru_request_as_schedule_preview() {
        let input = r#"
meta {
  name: Billing reconciliation
  type: http
  seq: 1
}

post {
  url: https://api.example.com/jobs/reconcile
  body: json
  auth: none
}

query {
  mode: incremental
}

headers {
  Authorization: Bearer token
  Content-Type: application/json
}

body:json {
  {
    "force": false
  }
}

tests {
  test("ok", () => {})
}
"#;

        let preview = parse_bruno_request(input, Some("billing.bru")).unwrap();

        assert_eq!(preview.schedule.name, "Billing reconciliation");
        assert_eq!(preview.schedule.method, "POST");
        assert_eq!(
            preview.schedule.target_url,
            "https://api.example.com/jobs/reconcile?mode=incremental"
        );
        assert_eq!(preview.schedule.status, "paused");
        assert_eq!(preview.schedule.cron_expression, "0 * * * *");
        assert_eq!(
            preview.schedule.headers["Content-Type"],
            Value::String("application/json".to_string())
        );
        assert!(
            preview
                .schedule
                .payload
                .unwrap()
                .contains("\"force\": false")
        );
        assert_eq!(preview.unsupported_blocks, vec!["tests"]);
    }

    #[test]
    fn imports_http_block_with_nested_headers_and_body_data() {
        let input = r#"
meta: {
  name: Create user
  type: http
}

http: {
  method: post
  url: https://api.example.com/users
  headers: {
    Content-Type: application/json
  }
  body: {
    type: json
    data: '''
      {
        "email": "admin@example.com"
      }
    '''
  }
}
"#;

        let preview = parse_bruno_request(input, None).unwrap();

        assert_eq!(preview.schedule.name, "Create user");
        assert_eq!(preview.schedule.method, "POST");
        assert_eq!(preview.schedule.target_url, "https://api.example.com/users");
        assert_eq!(
            preview.schedule.headers["Content-Type"],
            Value::String("application/json".to_string())
        );
        assert!(
            preview
                .schedule
                .payload
                .unwrap()
                .contains("admin@example.com")
        );
    }

    #[test]
    fn warns_when_import_contains_variables() {
        let input = r#"
get {
  url: {{baseUrl}}/health
  body: none
  auth: none
}

headers {
  Authorization: Bearer {{token}}
}
"#;

        let preview = parse_bruno_request(input, Some("health.bru")).unwrap();

        assert_eq!(preview.schedule.name, "health");
        assert_eq!(preview.schedule.method, "GET");
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("Target URL"))
        );
        assert!(
            preview
                .warnings
                .iter()
                .any(|warning| warning.contains("headers"))
        );
    }
}
