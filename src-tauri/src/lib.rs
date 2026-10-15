// Tauri v2 entry point.
//
// `fetch_url_text` / `post_json_text` run on the user's own machine / IP
// (desktop runtime), so YouTube serves caption data instead of blocking
// datacenter IPs, and the WebView never hits YouTube CORS restrictions.

use tauri_plugin_opener::OpenerExt;
use tauri::Manager;

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

/// Local vault: human-readable mirror of the library under
/// `{Documents}/Nukuzaa/[Folder]/[Document]/`.
///
/// Every write goes through `vault_root()` (the OS Documents folder) plus
/// sanitized relative segments — callers can never escape the vault with
/// `..` or absolute paths. Each document dir carries a `meta.json` with its
/// database id, which is how rename / delete / relocate find the right
/// directory even after the user renames folders or videos.
fn vault_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("documents folder unavailable: {e}"))?;
    Ok(docs.join("Nukuzaa"))
}

/// Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) can
/// never be created as files/dirs even with an extension — suffix them.
fn is_reserved_windows_name(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6"
            | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6"
            | "LPT7" | "LPT8" | "LPT9"
    )
}

/// Windows/macOS/Linux-safe file name: strip illegal chars, control codes
/// and trailing dots/spaces, guard reserved device names, cap length, never
/// empty. Note: case-only differences (`My Video` vs `my video`) resolve to
/// the same directory on Windows/macOS — `unique_doc_dir` disambiguates via
/// the `meta.json` owner check, so no extra handling is needed here.
fn sanitize_segment(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || c.is_control()
            {
                '_'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    let mut s: String = s.chars().take(80).collect();
    s = s.trim().trim_matches('.').to_string();
    // Check the stem (before any extension-like suffix) for reserved names.
    let stem = s.split('.').next().unwrap_or(&s);
    if is_reserved_windows_name(stem) {
        s = format!("{s}_");
    }
    if s.is_empty() {
        s = "Untitled".to_string();
    }
    s
}

fn read_meta_doc_id(dir: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(dir.join("meta.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("docId")?.as_str().map(|s| s.to_string())
}

/// Resolve `root/folder/doc` to a non-colliding sibling: if the directory
/// exists but belongs to a different document id, try `Name (2)`, ` (3)`…
fn unique_doc_dir(
    root: &std::path::Path,
    folder: &str,
    doc: &str,
    doc_id: &str,
) -> Result<std::path::PathBuf, String> {
    let folder = sanitize_segment(folder);
    let base = sanitize_segment(doc);
    for n in 0..100 {
        let name = if n == 0 {
            base.clone()
        } else {
            format!("{} ({})", base, n + 1)
        };
        let dir = root.join(&folder).join(&name);
        match read_meta_doc_id(&dir) {
            None => {
                // Missing dir, or a legacy dir without meta: claim it only
                // when empty/missing so we never merge two documents.
                if !dir.exists() {
                    return Ok(dir);
                }
                let empty = std::fs::read_dir(&dir)
                    .map(|mut it| it.next().is_none())
                    .unwrap_or(false);
                if empty {
                    return Ok(dir);
                }
                continue;
            }
            Some(owner) if owner == doc_id => return Ok(dir),
            _ => continue,
        }
    }
    Err("Could not find a free vault folder name.".to_string())
}

#[derive(serde::Deserialize)]
struct VaultFile {
    name: String,
    content: String,
}

/// Write (or refresh) one document's vault directory. Returns the dir path.
#[tauri::command]
async fn vault_write_doc(
    app: tauri::AppHandle,
    folder_title: String,
    doc_title: String,
    doc_id: String,
    files: Vec<VaultFile>,
) -> Result<String, String> {
    if doc_id.trim().is_empty() {
        return Err("Missing document id.".to_string());
    }
    if files.len() > 8 {
        return Err("Too many files.".to_string());
    }
    let root = vault_root(&app)?;
    // Claim loop: `unique_doc_dir` + `create_dir_all` is check-then-act, so
    // two concurrent writes for same-titled docs could pick the same dir.
    // Re-validate ownership after mkdir and step to the next suffix on
    // conflict instead of merging two documents into one directory.
    let mut dir = unique_doc_dir(&root, &folder_title, &doc_title, doc_id.trim())?;
    for _ in 0..100 {
        std::fs::create_dir_all(&dir).map_err(|e| format!("create vault dir failed: {e}"))?;
        match read_meta_doc_id(&dir) {
            Some(owner) if owner != doc_id.trim() => {
                // Lost the race — find the next free sibling and retry.
                let folder = sanitize_segment(&folder_title);
                let base = sanitize_segment(&doc_title);
                let mut next: Option<std::path::PathBuf> = None;
                for n in 1..100 {
                    let cand = root.join(&folder).join(format!("{} ({})", base, n + 1));
                    match read_meta_doc_id(&cand) {
                        Some(o) if o == doc_id.trim() => {
                            next = Some(cand);
                            break;
                        }
                        None if !cand.exists() => {
                            next = Some(cand);
                            break;
                        }
                        _ => continue,
                    }
                }
                dir = next.ok_or_else(|| "Could not find a free vault folder name.".to_string())?;
                continue;
            }
            _ => break,
        }
    }
    for f in files {
        if f.name.contains('/') || f.name.contains('\\') || f.name.contains("..") {
            return Err(format!("Bad vault file name: {}", f.name));
        }
        if f.content.len() > 5_000_000 {
            return Err(format!("Vault file too large: {}", f.name));
        }
        std::fs::write(dir.join(&f.name), f.content)
            .map_err(|e| format!("write {} failed: {e}", f.name))?;
    }
    let out = dir.to_string_lossy().into_owned();
    Ok(out)
}

/// Depth-first search for the directory whose meta.json carries `doc_id`.
fn find_doc_dir(root: &std::path::Path, doc_id: &str) -> Option<std::path::PathBuf> {
    let folders = std::fs::read_dir(root).ok()?;
    for folder in folders.flatten() {
        let fpath = folder.path();
        if !fpath.is_dir() {
            continue;
        }
        let docs = std::fs::read_dir(&fpath).ok()?;
        for entry in docs.flatten() {
            let dpath = entry.path();
            if dpath.is_dir() && read_meta_doc_id(&dpath).as_deref() == Some(doc_id) {
                return Some(dpath);
            }
        }
    }
    None
}

#[tauri::command]
async fn vault_remove_doc(app: tauri::AppHandle, doc_id: String) -> Result<bool, String> {
    let root = vault_root(&app)?;
    match find_doc_dir(&root, doc_id.trim()) {
        Some(dir) => {
            std::fs::remove_dir_all(&dir).map_err(|e| format!("remove vault doc failed: {e}"))?;
            // Prune the folder dir when it became empty.
            if let Some(parent) = dir.parent() {
                let empty = std::fs::read_dir(parent)
                    .map(|mut it| it.next().is_none())
                    .unwrap_or(false);
                if empty && parent != root {
                    let _ = std::fs::remove_dir(parent);
                }
            }
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Move one document's vault dir (used on cross-folder moves and renames).
#[tauri::command]
async fn vault_relocate_doc(
    app: tauri::AppHandle,
    doc_id: String,
    new_folder_title: String,
    new_doc_title: String,
) -> Result<String, String> {
    let root = vault_root(&app)?;
    let from = find_doc_dir(&root, doc_id.trim())
        .ok_or_else(|| "Document not found in local vault.".to_string())?;
    let to = unique_doc_dir(&root, &new_folder_title, &new_doc_title, doc_id.trim())?;
    if from == to {
        return Ok(to.to_string_lossy().into_owned());
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create vault dir failed: {e}"))?;
    }
    // If the target exists (stale twin), clear it first so rename succeeds.
    if to.exists() {
        std::fs::remove_dir_all(&to).map_err(|e| format!("replace vault doc failed: {e}"))?;
    }
    std::fs::rename(&from, &to).map_err(|e| format!("move vault doc failed: {e}"))?;
    if let Some(parent) = from.parent() {
        let empty = std::fs::read_dir(parent)
            .map(|mut it| it.next().is_none())
            .unwrap_or(false);
        if empty && parent != root {
            let _ = std::fs::remove_dir(parent);
        }
    }
    Ok(to.to_string_lossy().into_owned())
}

/// Rename a whole folder directory (title change). No-op when missing.
#[tauri::command]
async fn vault_relocate_folder(
    app: tauri::AppHandle,
    old_folder_title: String,
    new_folder_title: String,
) -> Result<String, String> {
    let root = vault_root(&app)?;
    let from = root.join(sanitize_segment(&old_folder_title));
    let mut to = root.join(sanitize_segment(&new_folder_title));
    if from == to || !from.exists() {
        if !to.exists() {
            std::fs::create_dir_all(&to).map_err(|e| format!("create vault dir failed: {e}"))?;
        }
        return Ok(to.to_string_lossy().into_owned());
    }
    // Never merge into an occupied name: suffix until free.
    let base = sanitize_segment(&new_folder_title);
    for n in 1..100 {
        if !to.exists() {
            break;
        }
        to = root.join(format!("{} ({})", base, n + 1));
    }
    std::fs::rename(&from, &to).map_err(|e| format!("rename vault folder failed: {e}"))?;
    Ok(to.to_string_lossy().into_owned())
}

/// Delete a folder directory and everything under it.
#[tauri::command]
async fn vault_remove_folder(app: tauri::AppHandle, folder_title: String) -> Result<bool, String> {
    let root = vault_root(&app)?;
    let dir = root.join(sanitize_segment(&folder_title));
    if !dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("remove vault folder failed: {e}"))?;
    Ok(true)
}

/// Ensure a folder directory exists (created alongside the DB folder).
#[tauri::command]
async fn vault_ensure_folder(app: tauri::AppHandle, folder_title: String) -> Result<String, String> {
    let root = vault_root(&app)?;
    let dir = root.join(sanitize_segment(&folder_title));
    std::fs::create_dir_all(&dir).map_err(|e| format!("create vault dir failed: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Absolute path of the vault root for display / reveal-in-explorer.
#[tauri::command]
async fn vault_root_path(app: tauri::AppHandle) -> Result<String, String> {
    let root = vault_root(&app)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("create vault dir failed: {e}"))?;
    Ok(root.to_string_lossy().into_owned())
}

/// Open the vault (or a path inside it) in the OS file manager.
#[tauri::command]
async fn vault_reveal(app: tauri::AppHandle, relative: Option<String>) -> Result<(), String> {
    let root = vault_root(&app)?;
    let mut target = root;
    if let Some(rel) = relative {
        for seg in rel.split(['/', '\\']) {
            if seg.is_empty() || seg == "." || seg == ".." {
                return Err("Bad vault path.".to_string());
            }
            target = target.join(sanitize_segment(seg));
        }
    }
    app.opener()
        .open_path(target.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("could not open vault: {e}"))
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
        .invoke_handler(tauri::generate_handler![
            fetch_url_text,
            post_json_text,
            open_external,
            vault_write_doc,
            vault_remove_doc,
            vault_relocate_doc,
            vault_relocate_folder,
            vault_remove_folder,
            vault_ensure_folder,
            vault_root_path,
            vault_reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nukuzaa");
}
