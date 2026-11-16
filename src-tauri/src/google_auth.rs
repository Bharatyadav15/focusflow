use crate::store::LocalStore;
use crate::types::{AppSettings, GoogleTokens};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

// Built-in Google OAuth client, supplied at build time via environment variables
// (FOCUSFLOW_CLIENT_ID / FOCUSFLOW_CLIENT_SECRET) so it is never committed to git.
// Used only when the user has not entered their own client in Settings.
const BUILTIN_CLIENT_ID: Option<&str> = option_env!("FOCUSFLOW_CLIENT_ID");
const BUILTIN_CLIENT_SECRET: Option<&str> = option_env!("FOCUSFLOW_CLIENT_SECRET");

/// Returns (client_id, client_secret): the user's own client if they set one,
/// otherwise the built-in one.
fn effective_client(settings: &AppSettings) -> (String, String) {
    let id = settings.google_client_id.trim();
    if !id.is_empty() {
        return (id.to_string(), settings.google_client_secret.trim().to_string());
    }
    (
        BUILTIN_CLIENT_ID.unwrap_or("").trim().to_string(),
        BUILTIN_CLIENT_SECRET.unwrap_or("").trim().to_string(),
    )
}

const SCOPES: &str = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks";

#[derive(Debug, Serialize)]
pub struct AuthResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

pub async fn start_google_oauth(store: Arc<LocalStore>) -> AuthResult {
    let settings = store.get_settings();
    let (client_id, client_secret) = effective_client(&settings);

    if client_id.is_empty() {
        return AuthResult {
            ok: false,
            error: Some("This build has no built-in Google client. Open Settings > Advanced and enter your own OAuth Client ID.".to_string()),
        };
    }

    let listener = match TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            return AuthResult {
                ok: false,
                error: Some(format!("Failed to start local OAuth callback listener: {}", e)),
            }
        }
    };

    let port = match listener.local_addr() {
        Ok(addr) => addr.port(),
        Err(e) => {
            return AuthResult {
                ok: false,
                error: Some(format!("Failed to read callback port: {}", e)),
            }
        }
    };

    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    let mut auth_url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    // Open in system default browser on Windows
    // rundll32 passes the URL through intact; `cmd /C start` would cut it at every '&'.
    let _ = std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", auth_url.as_str()])
        .spawn();

    let accept_res = tokio::time::timeout(
        std::time::Duration::from_secs(180),
        listener.accept(),
    )
    .await;

    let (mut stream, _) = match accept_res {
        Ok(Ok(pair)) => pair,
        Ok(Err(e)) => {
            return AuthResult {
                ok: false,
                error: Some(format!("OAuth callback connection failed: {}", e)),
            }
        }
        Err(_) => {
            return AuthResult {
                ok: false,
                error: Some("Google sign-in timed out.".to_string()),
            }
        }
    };

    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).await.unwrap_or(0);
    let req_str = String::from_utf8_lossy(&buf[..n]);
    let first_line = req_str.lines().next().unwrap_or("");
    let path = first_line.split_whitespace().nth(1).unwrap_or("/");

    let full_url = format!("http://127.0.0.1:{}{}", port, path);
    let parsed_url = Url::parse(&full_url).unwrap_or_else(|_| Url::parse("http://127.0.0.1").unwrap());

    let mut code: Option<String> = None;
    let mut oauth_err: Option<String> = None;
    for (k, v) in parsed_url.query_pairs() {
        if k == "code" {
            code = Some(v.to_string());
        } else if k == "error" {
            oauth_err = Some(v.to_string());
        }
    }

    if oauth_err.is_some() || code.is_none() {
        let html = "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\n<h2>Google Sign-In Cancelled</h2>";
        let _ = stream.write_all(html.as_bytes()).await;
        return AuthResult {
            ok: false,
            error: Some(oauth_err.unwrap_or_else(|| "Authorization code missing".to_string())),
        };
    }

    let code = code.unwrap();
    let client = reqwest::Client::new();
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("code", code.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret.as_str()));
    }

    let token_res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await;

    match token_res {
        Ok(resp) => {
            let status = resp.status();
            let body: TokenResponse = resp.json().await.unwrap_or(TokenResponse {
                access_token: None,
                refresh_token: None,
                expires_in: None,
                error: Some("Invalid JSON response".to_string()),
                error_description: None,
            });

            if !status.is_success() || body.access_token.is_none() {
                let err_msg = body
                    .error_description
                    .or(body.error)
                    .unwrap_or_else(|| "Token exchange failed".to_string());
                let html = format!(
                    "HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html\r\n\r\n<h2>Sign-In Failed</h2><p>{}</p>",
                    err_msg
                );
                let _ = stream.write_all(html.as_bytes()).await;
                return AuthResult {
                    ok: false,
                    error: Some(err_msg),
                };
            }

            let now_ms = Utc::now().timestamp_millis();
            let tokens = GoogleTokens {
                access_token: body.access_token.unwrap(),
                refresh_token: body.refresh_token,
                expiry_date: now_ms + body.expires_in.unwrap_or(3600) * 1000,
            };
            store.set_tokens(Some(tokens));

            let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style=\"font-family:sans-serif;background:#0b0e14;color:#f1f5f9;display:flex;align-items:center;justify-content:center;height:100vh;\"><div><h2>FocusFlow Connected!</h2><p>You can close this browser tab and return to FocusFlow.</p></div></body></html>";
            let _ = stream.write_all(html.as_bytes()).await;

            AuthResult {
                ok: true,
                error: None,
            }
        }
        Err(e) => AuthResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

pub async fn get_valid_access_token(store: &LocalStore) -> Option<String> {
    let tokens = store.get_tokens()?;
    let now_ms = Utc::now().timestamp_millis();

    if tokens.expiry_date > now_ms + 60_000 {
        return Some(tokens.access_token);
    }

    let refresh_token = tokens.refresh_token.clone()?;
    let settings = store.get_settings();
    let (client_id, client_secret) = effective_client(&settings);
    if client_id.is_empty() {
        return None;
    }

    let client = reqwest::Client::new();
    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];
    if !client_secret.is_empty() {
        form.push(("client_secret", client_secret.as_str()));
    }

    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let body: TokenResponse = resp.json().await.ok()?;
    let access_token = body.access_token?;
    let updated = GoogleTokens {
        access_token: access_token.clone(),
        refresh_token: body.refresh_token.or(Some(refresh_token)),
        expiry_date: now_ms + body.expires_in.unwrap_or(3600) * 1000,
    };
    store.set_tokens(Some(updated));
    Some(access_token)
}
