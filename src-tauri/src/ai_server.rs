use crate::planner;
use crate::types::TaskItem;
use crate::{rebuild_tray_menu, AppState};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub use crate::ai_audit::{execute_tool, read_audit, undo_audit};
pub use crate::ai_tools::get_mcp_tools_schema;
pub const AI_SERVER_PORT: u16 = 27182;

const MAX_BODY_BYTES: usize = 1_048_576; // 1 MB

// ---------- Access token (shared secret) ----------

static TOKEN: std::sync::OnceLock<std::sync::Mutex<String>> = std::sync::OnceLock::new();

fn token_cell() -> &'static std::sync::Mutex<String> {
    TOKEN.get_or_init(|| std::sync::Mutex::new(String::new()))
}

/// The token currently accepted by the server.
pub fn current_token() -> String {
    token_cell()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn data_dir() -> std::path::PathBuf {
    std::env::var("APPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("focusflow")
}

/// Location of the shared secret: %APPDATA%\focusflow\ai-token
pub fn token_path() -> std::path::PathBuf {
    data_dir().join("ai-token")
}

fn token_looks_valid(t: &str) -> bool {
    t.len() >= 32
        && t.chars().all(|c| c.is_ascii_hexdigit())
        && !t.chars().all(|c| c == '0')
}

/// 32 random bytes as hex. Fails (instead of returning a guessable value)
/// if the system random generator is unavailable.
fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| format!("random generator unavailable: {}", e))?;
    if bytes.iter().all(|b| *b == 0) {
        return Err("random generator returned an all-zero value".to_string());
    }
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Writes the token file and reads it back to be sure it really landed.
fn write_token_file(token: &str) -> Result<(), String> {
    let path = token_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("cannot create {:?}: {}", parent, e))?;
    }
    std::fs::write(&path, token).map_err(|e| format!("cannot write {:?}: {}", path, e))?;
    match std::fs::read_to_string(&path) {
        Ok(back) if back.trim() == token => Ok(()),
        _ => Err(format!("token file {:?} could not be verified after writing", path)),
    }
}

fn init_token() -> Result<String, String> {
    if let Ok(existing) = std::fs::read_to_string(token_path()) {
        let t = existing.trim().to_string();
        if token_looks_valid(&t) {
            return Ok(t);
        }
    }
    let t = generate_token()?;
    write_token_file(&t)?;
    Ok(t)
}

/// Replaces the token. Old tokens stop working immediately.
pub fn regenerate_token() -> Result<String, String> {
    let t = generate_token()?;
    write_token_file(&t)?;
    *token_cell().lock().unwrap_or_else(|e| e.into_inner()) = t.clone();
    Ok(t)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub fn start_ai_control_server(app: AppHandle) {
    match init_token() {
        Ok(t) => {
            *token_cell().lock().unwrap_or_else(|e| e.into_inner()) = t;
        }
        Err(e) => {
            // Never run an unauthenticated (or weakly authenticated) server.
            let msg = format!("Token init failed: {}", e);
            eprintln!("FocusFlow AI server NOT started: {}", msg);
            crate::store::append_app_log("MCP", &msg);
            if let Some(s) = app.try_state::<AppState>() {
                *s.mcp_status.lock().unwrap() = (false, msg);
            }
            rebuild_tray_menu(&app);
            return;
        }
    }
    tauri::async_runtime::spawn(async move {
        let addr = format!("127.0.0.1:{}", AI_SERVER_PORT);
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                crate::store::append_app_log("MCP", &format!("Listening on {}", addr));
                if let Some(s) = app.try_state::<AppState>() {
                    *s.mcp_status.lock().unwrap() = (true, format!("Active ({})", addr));
                }
                rebuild_tray_menu(&app);
                l
            }
            Err(e) => {
                let msg = format!("Could not bind {}: {}", addr, e);
                eprintln!("FocusFlow AI server {}", msg);
                crate::store::append_app_log("MCP", &msg);
                if let Some(s) = app.try_state::<AppState>() {
                    *s.mcp_status.lock().unwrap() = (false, format!("Bind failed on {}", AI_SERVER_PORT));
                }
                rebuild_tray_menu(&app);
                return;
            }
        };

        loop {
            if let Ok((stream, _)) = listener.accept().await {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        handle_http_connection(stream, app_clone),
                    )
                    .await;
                });
            }
        }
    });
}

async fn handle_http_connection(mut stream: TcpStream, app: AppHandle) -> Result<(), ()> {
    let mut buf = vec![0u8; 65536];
    let mut total_read = 0usize;
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        let n = stream.read(&mut buf[total_read..]).await.map_err(|_| ())?;
        if n == 0 {
            break;
        }
        total_read += n;

        if header_end.is_none() {
            if let Some(pos) = find_subsequence(&buf[..total_read], b"\r\n\r\n") {
                let h_end = pos + 4;
                header_end = Some(h_end);
                let headers_str = String::from_utf8_lossy(&buf[..pos]);
                for line in headers_str.lines() {
                    if let Some((k, v)) = line.split_once(':') {
                        if k.trim().eq_ignore_ascii_case("content-length") {
                            content_length = v.trim().parse::<usize>().unwrap_or(0);
                            if content_length > MAX_BODY_BYTES {
                                return send_json_response(
                                    &mut stream,
                                    413,
                                    &json!({ "ok": false, "error": "Request body too large" }),
                                )
                                .await;
                            }
                        }
                    }
                }
            }
        }

        if let Some(h_end) = header_end {
            if total_read >= h_end + content_length {
                break;
            }
            if h_end + content_length > buf.len() {
                buf.resize(h_end + content_length, 0);
            }
        } else if total_read == buf.len() {
            break;
        }
    }

    if total_read == 0 {
        return Ok(());
    }

    let h_end = header_end.unwrap_or(total_read);
    let req_head = String::from_utf8_lossy(&buf[..h_end]);
    let first_line = req_head.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_path = parts.next().unwrap_or("/");
    let path = raw_path.split('?').next().unwrap_or("/");

    // Collect the headers we care about.
    let mut origin_header: Option<String> = None;
    let mut host_header: Option<String> = None;
    let mut auth_header: Option<String> = None;
    for line in req_head.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            let v = v.trim().to_string();
            if k.eq_ignore_ascii_case("origin") {
                origin_header = Some(v);
            } else if k.eq_ignore_ascii_case("host") {
                host_header = Some(v);
            } else if k.eq_ignore_ascii_case("authorization") {
                auth_header = Some(v);
            }
        }
    }

    // Requests from web pages always carry an Origin header; our bridge does not.
    if origin_header.is_some() {
        return send_json_response(
            &mut stream,
            403,
            &json!({ "ok": false, "error": "Browser requests are not allowed" }),
        )
        .await;
    }

    // Only accept requests addressed to localhost (blocks DNS-rebinding tricks).
    let host_ok = match host_header.as_deref() {
        Some(h) => {
            let h = h.to_ascii_lowercase();
            h == format!("127.0.0.1:{}", AI_SERVER_PORT)
                || h == format!("localhost:{}", AI_SERVER_PORT)
        }
        None => false,
    };
    if !host_ok {
        return send_json_response(
            &mut stream,
            403,
            &json!({ "ok": false, "error": "Invalid Host header" }),
        )
        .await;
    }

    if method.eq_ignore_ascii_case("OPTIONS") {
        return send_json_response(
            &mut stream,
            403,
            &json!({ "ok": false, "error": "Not allowed" }),
        )
        .await;
    }

    // Health check stays open but reveals no personal data.
    if method == "GET" && (path == "/" || path == "/api/status") {
        return send_json_response(
            &mut stream,
            200,
            &json!({ "ok": true, "app": "FocusFlow", "auth": "bearer token required for all other endpoints" }),
        )
        .await;
    }

    // Everything else needs the secret token.
    let token = current_token();
    let provided = auth_header
        .as_deref()
        .and_then(|h| h.strip_prefix("Bearer ").or_else(|| h.strip_prefix("bearer ")))
        .unwrap_or("")
        .trim();
    if !constant_time_eq(provided.as_bytes(), token.as_bytes()) {
        return send_json_response(
            &mut stream,
            401,
            &json!({ "ok": false, "error": "Unauthorized: missing or invalid token. See %APPDATA%\\focusflow\\ai-token" }),
        )
        .await;
    }

    let body_bytes = if h_end <= total_read {
        &buf[h_end..total_read]
    } else {
        &[]
    };
    let body_json: Value = serde_json::from_slice(body_bytes).unwrap_or(Value::Null);

    match (method, path) {
        ("POST", "/api/show") => {
            // Used by a second FocusFlow launch to bring this instance to the front.
            crate::ensure_main_window(&app);
            send_json_response(&mut stream, 200, &json!({ "ok": true })).await
        }
        ("GET", "/api/tools") => {
            let tools = get_mcp_tools_schema();
            let openai_tools: Vec<Value> = tools
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t["name"],
                            "description": t["description"],
                            "parameters": t["inputSchema"]
                        }
                    })
                })
                .collect();
            let gemini_declarations: Vec<Value> = tools
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|t| {
                    json!({
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["inputSchema"]
                    })
                })
                .collect();
            send_json_response(
                &mut stream,
                200,
                &json!({
                    "server": "FocusFlow AI Control Server",
                    "endpoint": format!("http://127.0.0.1:{}", AI_SERVER_PORT),
                    "mcpEndpoint": format!("http://127.0.0.1:{}/mcp", AI_SERVER_PORT),
                    "toolCallEndpoint": format!("http://127.0.0.1:{}/api/tool", AI_SERVER_PORT),
                    "mcpTools": tools,
                    "openaiTools": openai_tools,
                    "geminiFunctionDeclarations": gemini_declarations,
                }),
            )
            .await
        }
        ("POST", "/api/tool") => {
            let name = body_json
                .get("name")
                .or_else(|| body_json.get("tool"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let args = body_json
                .get("arguments")
                .or_else(|| body_json.get("args"))
                .or_else(|| body_json.get("parameters"))
                .cloned()
                .unwrap_or_else(|| body_json.clone());
            let result = execute_tool(&app, name, &args).await;
            send_json_response(&mut stream, 200, &result).await
        }
        ("POST", "/mcp") => {
            let rpc_resp = handle_mcp_jsonrpc(&app, &body_json).await;
            match rpc_resp {
                Some(resp_val) => send_json_response(&mut stream, 200, &resp_val).await,
                None => send_empty_response(&mut stream, 202).await,
            }
        }
        _ => {
            send_json_response(
                &mut stream,
                404,
                &json!({
                    "ok": false,
                    "error": format!("Unknown endpoint {} {}. Use GET /api/tools, POST /api/tool, or POST /mcp", method, path)
                }),
            )
            .await
        }
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

async fn send_json_response(stream: &mut TcpStream, status: u16, body: &Value) -> Result<(), ()> {
    let status_text = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        413 => "Payload Too Large",
        404 => "Not Found",
        _ => "Internal Server Error",
    };
    let json_bytes = serde_json::to_vec_pretty(body).unwrap_or_default();
    let header = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        status_text,
        json_bytes.len()
    );
    stream.write_all(header.as_bytes()).await.map_err(|_| ())?;
    stream.write_all(&json_bytes).await.map_err(|_| ())?;
    let _ = stream.flush().await;
    Ok(())
}

async fn send_empty_response(stream: &mut TcpStream, status: u16) -> Result<(), ()> {
    let header = format!(
        "HTTP/1.1 {} Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        status
    );
    stream.write_all(header.as_bytes()).await.map_err(|_| ())?;
    let _ = stream.flush().await;
    Ok(())
}

async fn handle_mcp_jsonrpc(app: &AppHandle, req: &Value) -> Option<Value> {
    let id = req.get("id").cloned();
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or_else(|| json!({}));

    // Notifications have no id
    if id.is_none() || method.starts_with("notifications/") {
        return None;
    }

    let req_id = id.unwrap_or(Value::Null);

    match method {
        "initialize" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {}
                },
                "serverInfo": {
                    "name": "focusflow-mcp",
                    "version": "1.1.0"
                }
            }
        })),
        "ping" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {}
        })),
        "resources/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "resources": [
                    {
                        "uri": "focusflow://today",
                        "name": "FocusFlow Today Overview",
                        "description": "Live snapshot of active timer, today's schedule, and open tasks.",
                        "mimeType": "application/json"
                    },
                    {
                        "uri": "focusflow://projects",
                        "name": "FocusFlow Projects",
                        "description": "All projects, milestones, and linked task counts.",
                        "mimeType": "application/json"
                    },
                    {
                        "uri": "focusflow://stats",
                        "name": "FocusFlow Focus Analytics",
                        "description": "Today's focus minutes, daily goal progress, streak, and project breakdown.",
                        "mimeType": "application/json"
                    }
                ]
            }
        })),
        "resources/read" => {
            let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");
            let Some(state) = app.try_state::<AppState>() else {
                return Some(json!({
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": { "code": -32000, "message": "AppState unavailable" }
                }));
            };
            let app_data = state.store.get_app_data();
            let payload = match uri {
                "focusflow://today" => {
                    let timer = state.timer.lock().unwrap().clone();
                    let mut events = state.cached_events.lock().unwrap().clone();
                    if events.is_empty() {
                        events = state.store.get_local_events();
                    }
                    let open_tasks: Vec<&TaskItem> =
                        app_data.tasks.iter().filter(|t| !t.completed).collect();
                    json!({
                        "timer": timer,
                        "todayEvents": events,
                        "openTasks": open_tasks,
                    })
                }
                "focusflow://projects" => json!({ "projects": app_data.projects }),
                "focusflow://stats" => planner::compute_focus_stats(&app_data),
                _ => {
                    return Some(json!({
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": { "code": -32602, "message": format!("Unknown resource URI: {}", uri) }
                    }));
                }
            };
            let text = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".to_string());
            Some(json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "contents": [
                        {
                            "uri": uri,
                            "mimeType": "application/json",
                            "text": text
                        }
                    ]
                }
            }))
        }
        "tools/list" => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "tools": get_mcp_tools_schema()
            }
        })),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let res = execute_tool(app, name, &args).await;
            let is_err = res.get("ok").and_then(|v| v.as_bool()) == Some(false);
            let text = serde_json::to_string_pretty(&res).unwrap_or_else(|_| "{}".to_string());
            Some(json!({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": text
                        }
                    ],
                    "isError": is_err
                }
            }))
        }
        _ => Some(json!({
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", method)
            }
        })),
    }
}
