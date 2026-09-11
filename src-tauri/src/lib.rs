// Tauri v2 entry point.
//
// `fetch_url_text` / `post_json_text` run on the user's own machine / IP
// (desktop runtime), so YouTube serves caption data instead of blocking
// datacenter IPs, and the WebView never hits YouTube CORS restrictions.

use tauri_plugin_opener::OpenerExt;

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::ACCEPT_LANGUAGE,
                reqwest::header::HeaderValue::from_static("en-US,en;q=0.9"),
            );
            h
        })
        .build()
        .map_err(|e| format!("http client error: {e}"))
}

/// YouTube origins this backend is allowed to contact. Everything transcript
/// extraction needs lives under these hosts; nothing else is reachable.
fn is_allowed(url: &str) -> bool {
    [
        "https://www.youtube.com/",
        "https://youtube.com/",
        "https://m.youtube.com/",
        "https://music.youtube.com/",
        "https://youtu.be/",
        "https://www.youtube-nocookie.com/",
        "https://i.ytimg.com/",
        "https://www.googlevideo.com/",
    ]
    .iter()
    .any(|p| url.starts_with(p))
}

#[tauri::command]
async fn fetch_url_text(url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs are allowed.".to_string());
    }
    if !is_allowed(&url) {
        return Err("URL host is not allow-listed for fetching.".to_string());
    }

    let resp = http_client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("YouTube responded with HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("read body failed: {e}"))
}

/// POST a JSON body and return the response text. Used for the YouTubei
/// `player` endpoint, which yields session-independent caption URLs
/// (the scraped watch-page URLs are session-bound and return empty bodies).
#[tauri::command]
async fn post_json_text(url: String, body: String) -> Result<String, String> {
    if !url.starts_with("https://www.youtube.com/youtubei/") {
        return Err("Only the YouTubei API endpoint is allow-listed for POST.".to_string());
    }
    if body.len() > 4096 {
        return Err("POST body too large.".to_string());
    }

    let resp = http_client()?
        .post(&url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("YouTube responded with HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("read body failed: {e}"))
}

#[tauri::command]
async fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("could not open URL: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![fetch_url_text, post_json_text, open_external])
        .run(tauri::generate_context!())
        .expect("error while running Nukuzaa");
}
