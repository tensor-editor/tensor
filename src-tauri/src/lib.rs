use tauri::menu::{Menu, MenuItem, Submenu};
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();

            // File menu
            let new_item = MenuItem::with_id(handle, "menu-new", "New", true, Some("CmdOrCtrl+N"))?;
            let open_item =
                MenuItem::with_id(handle, "menu-open", "Open", true, Some("CmdOrCtrl+O"))?;
            let save_item =
                MenuItem::with_id(handle, "menu-save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as_item =
                MenuItem::with_id(handle, "menu-save-as", "Save As…", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(handle, "menu-quit", "Quit", true, Some("CmdOrCtrl+Q"))?;

            let file_menu = Submenu::with_items(
                handle,
                "File",
                true,
                &[&new_item, &open_item, &save_item, &save_as_item, &quit_item],
            )?;

            // Edit menu
            let undo_item =
                MenuItem::with_id(handle, "menu-undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo_item =
                MenuItem::with_id(handle, "menu-redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
            let cut_item = MenuItem::with_id(handle, "menu-cut", "Cut", true, Some("CmdOrCtrl+X"))?;
            let copy_item =
                MenuItem::with_id(handle, "menu-copy", "Copy", true, Some("CmdOrCtrl+C"))?;
            let paste_item =
                MenuItem::with_id(handle, "menu-paste", "Paste", true, Some("CmdOrCtrl+V"))?;

            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[&undo_item, &redo_item, &cut_item, &copy_item, &paste_item],
            )?;

            // View menu
            let dark_mode_item = MenuItem::with_id(
                handle,
                "menu-toggle-dark-mode",
                "Toggle Dark Mode",
                true,
                None::<&str>,
            )?;

            let view_menu = Submenu::with_items(handle, "View", true, &[&dark_mode_item])?;

            let menu = Menu::with_items(handle, &[&file_menu, &edit_menu, &view_menu])?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-event", event.id().0.clone());
        })
        .invoke_handler(tauri::generate_handler![fetch_link_metadata, fetch_url, package_document, unpackage_document])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Serialize)]
struct LinkMetadata {
    title: Option<String>,
    description: Option<String>,
    favicon: Option<String>,
}

#[tauri::command]
async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; TensorEditor/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let final_url = response.url().clone();
    let html = response.text().await.map_err(|e| e.to_string())?;

    let document = scraper::Html::parse_document(&html);

    let title_selector = scraper::Selector::parse("title").unwrap();
    let title = document
        .select(&title_selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string());

    let og_desc_selector = scraper::Selector::parse(r#"meta[property="og:description"]"#).unwrap();
    let description = document
        .select(&og_desc_selector)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.to_string())
        .or_else(|| {
            let meta_desc_selector =
                scraper::Selector::parse(r#"meta[name="description"]"#).unwrap();
            document
                .select(&meta_desc_selector)
                .next()
                .and_then(|el| el.value().attr("content"))
                .map(|s| s.to_string())
        });

    let icon_selector =
        scraper::Selector::parse(r#"link[rel="icon"], link[rel="shortcut icon"]"#).unwrap();
    let favicon = document
        .select(&icon_selector)
        .next()
        .and_then(|el| el.value().attr("href"))
        .and_then(|href| final_url.join(href).ok())
        .map(|u| u.to_string())
        .or_else(|| final_url.join("/favicon.ico").ok().map(|u| u.to_string()));

    Ok(LinkMetadata {
        title,
        description,
        favicon,
    })
}

#[tauri::command]
async fn fetch_url(url: String, ua: Option<String>) -> Result<tauri::ipc::Response, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(ua.unwrap_or_else(|| "Mozilla/5.0 (compatible; TensorEditor/1.0)".to_string()));
    let client = builder.build().map_err(|e| e.to_string())?;

    let response = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

// ─── M-IMAGES-0: the .wpdoc v2 container ─────────────────────────────────
//
// BREAKING FORMAT EVENT (#28 format note): .wpdoc v1 was a bare JSON
// file; v2 is a zip container. Zero users at the event (the M2
// disclaimer) — the v1→v2 converter on the TS side is PERMANENT: v1
// files open forever, saves always write v2.
//
// Container layout (the packager is DUMB — it writes exactly what the
// caller passes; save-time GC of unreferenced media happens TS-side):
//     document.json   today's schema, verbatim — DEFLATED
//     manifest.json   { "wpdocVersion": 2,
//                      "media": [{ "id": "<sha256>", "ext": "png" }] }
//     media/<sha256>.<ext>   raw bytes — STORED (png/jpeg don't
//                            deflate; only document.json does)
//
// Registration is the ONLY capability surface these need: app
// commands live behind the invoke_handler, not the fs plugin's
// scope table (core:default covers invoking the app's own commands).
//
// Wire format over IPC: media bytes travel base64 (JSON struct), the
// fetch_url raw-binary channel is for single byte payloads only.

#[derive(serde::Deserialize, Debug)]
struct PackageMedia {
    id: String,
    ext: String,
    #[serde(rename = "bytesB64")]
    bytes_b64: String,
}

#[derive(serde::Serialize, Debug)]
struct UnpackMedia {
    id: String,
    ext: String,
    #[serde(rename = "bytesB64")]
    bytes_b64: String,
}

#[derive(serde::Serialize, Debug)]
struct UnpackResult {
    document: String,
    media: Vec<UnpackMedia>,
}

use base64::Engine as _;
use std::io::Write as _;

const WPDOC_VERSION: u64 = 2;
/// v1 files are plain JSON — no zip magic. The marker string the TS
/// layer detects for the legacy converter.
const NOT_ZIP_ERR: &str = "NOT_ZIP: not a v2 container (v1 plain-JSON file?)";

fn package_wpdoc(
    path: &str,
    document_json: &str,
    media: &[PackageMedia],
) -> Result<(), Box<dyn std::error::Error>> {
    // ATOMIC (the writeDocumentAtomic pattern, Rust-side): build the
    // container at {path}.tmp, rename into place. An interrupted
    // package leaves the previous file intact — and NO .tmp litter.
    let tmp_path = format!("{}.tmp", path);
    let build = (|| -> Result<(), Box<dyn std::error::Error>> {
        let file = std::fs::File::create(&tmp_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let deflate = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let stored = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        zip.start_file("document.json", deflate)?;
        zip.write_all(document_json.as_bytes())?;

        let manifest = serde_json::json!({
            "wpdocVersion": WPDOC_VERSION,
            "media": media.iter().map(|m| serde_json::json!({
                "id": m.id,
                "ext": m.ext,
            })).collect::<Vec<_>>(),
        });
        zip.start_file("manifest.json", deflate)?;
        zip.write_all(serde_json::to_string(&manifest)?.as_bytes())?;

        for m in media {
            let bytes = base64::engine::general_purpose::STANDARD.decode(&m.bytes_b64)?;
            zip.start_file(format!("media/{}.{}", m.id, m.ext), stored)?;
            zip.write_all(&bytes)?;
        }
        zip.finish()?;
        Ok(())
    })();
    match build {
        Ok(()) => {
            std::fs::rename(&tmp_path, path)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path); // no litter
            Err(e)
        }
    }
}

fn unpackage_wpdoc(path: &str) -> Result<UnpackResult, Box<dyn std::error::Error>> {
    let mut file = std::fs::File::open(path)?;
    let mut magic = [0u8; 2];
    std::io::Read::read_exact(&mut file, &mut magic)?;
    if &magic != b"PK" {
        return Err(NOT_ZIP_ERR.into());
    }
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;

    let mut document = String::new();
    if let Ok(mut entry) = archive.by_name("document.json") {
        std::io::Read::read_to_string(&mut entry, &mut document)?;
    }
    let mut media = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        if let Some(file_name) = name.strip_prefix("media/") {
            let (id, ext) = match file_name.split_once('.') {
                Some((id, ext)) => (id.to_string(), ext.to_string()),
                None => continue,
            };
            let mut bytes = Vec::new();
            std::io::Read::read_to_end(&mut entry, &mut bytes)?;
            media.push(UnpackMedia {
                id,
                ext,
                bytes_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
            });
        }
    }
    Ok(UnpackResult { document, media })
}

#[tauri::command]
async fn package_document(
    path: String,
    document_json: String,
    media: Vec<PackageMedia>,
) -> Result<(), String> {
    package_wpdoc(&path, &document_json, &media).map_err(|e| e.to_string())
}

#[tauri::command]
async fn unpackage_document(path: String) -> Result<UnpackResult, String> {
    unpackage_wpdoc(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod wpdoc_tests {
    use super::*;

    fn tmp(tag: &str) -> String {
        let dir = std::env::temp_dir();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{}/wpdoc-test-{}-{}.wpdoc", dir.display(), tag, unique)
    }

    fn media(id: &str, ext: &str, bytes: &[u8]) -> PackageMedia {
        PackageMedia {
            id: id.to_string(),
            ext: ext.to_string(),
            bytes_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    const DOC_JSON: &str = r#"{"version":1,"docJSON":{"type":"doc","content":[{"type":"paragraph","attrs":{"blockId":"b1","styleId":"normal"},"content":[{"type":"text","text":"hello container"}]}]},"metadata":{"modifiedAt":"2026-01-01T00:00:00.000Z","pageSetup":{"pageSize":"Letter","margins":{"top":72,"bottom":72,"left":72,"right":72},"pageGap":32}}}"#;

    #[test]
    fn v2_round_trip_document_and_media_byte_identical() {
        let path = tmp("roundtrip");
        let png: Vec<u8> = (0..4096u32).map(|i| (i % 251) as u8).collect(); // incompressible "png"
        package_wpdoc(&path, DOC_JSON, &[media("a1b2c3", "png", &png)]).unwrap();
        let result = unpackage_wpdoc(&path).unwrap();
        assert_eq!(result.document, DOC_JSON);
        assert_eq!(result.media.len(), 1);
        assert_eq!(result.media[0].id, "a1b2c3");
        assert_eq!(result.media[0].ext, "png");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&result.media[0].bytes_b64)
            .unwrap();
        assert_eq!(bytes, png); // byte-identical, sha-identical
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn v1_plain_json_is_not_zip_the_converter_marker() {
        let path = tmp("v1");
        std::fs::write(&path, DOC_JSON).unwrap();
        let err = unpackage_wpdoc(&path).unwrap_err().to_string();
        assert!(err.contains("NOT_ZIP"), "got: {err}");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupted_container_is_an_error_never_a_crash() {
        let path = tmp("corrupt");
        std::fs::write(&path, b"PK\x03\x04nonsense-not-a-real-archive").unwrap();
        assert!(unpackage_wpdoc(&path).is_err());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn interrupted_package_leaves_previous_file_intact() {
        let path = tmp("atomic");
        package_wpdoc(&path, DOC_JSON, &[]).unwrap();
        let before = std::fs::read(&path).unwrap();
        // Invalid base64 aborts MID-package (after document.json is
        // already written into the tmp container) — the rename must
        // never happen and the previous file must survive verbatim.
        let bad = PackageMedia {
            id: "x".into(),
            ext: "png".into(),
            bytes_b64: "!!!not-base64!!!".into(),
        };
        assert!(package_wpdoc(&path, DOC_JSON, &[bad]).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        // And no .tmp litter is left behind.
        assert!(!std::path::Path::new(&format!("{path}.tmp")).exists());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn size_receipt_deflated_document_beats_data_url_media() {
        // The format win, measured: a doc-sized JSON (the perf-71
        // fixture's scale) deflates hard; a real-world PNG's bytes are
        // stored raw either way — but a DATA-URL embedding of that
        // same PNG inflates it by ~4/3 and lives INSIDE the JSON,
        // defeating its deflate too.
        let doc_sized: String = r#"{"version":1,"docJSON":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""#.to_string() + &"tensor engine paginates orphan ".repeat(20_000) + r#""}]}]},"metadata":{}}"#;
        let png: Vec<u8> = (0..30_000u32).map(|i| ((i * 31 + i / 7) % 256) as u8).collect();
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);

        // v2: deflated document + stored media.
        let v2_path = tmp("size-v2");
        package_wpdoc(&v2_path, &doc_sized, &[media("deadbeef", "png", &png)]).unwrap();
        let v2_size = std::fs::metadata(&v2_path).unwrap().len();

        // Data-URL equivalent: the PNG base64-embedded in the JSON.
        let data_url_doc = format!("{}\"data:image/png;base64,{}\"}}]}}]}}", doc_sized.trim_end_matches('}'), b64);
        // The V1-format data-URL equivalent: plain JSON on disk.
        let du_path = tmp("size-du");
        std::fs::write(&du_path, &data_url_doc).unwrap();
        let du_size = std::fs::metadata(&du_path).unwrap().len();

        println!("SIZE-RECEIPT v2={v2_size} bytes, v1-data-url={du_size} bytes (ratio 1:{})", du_size / v2_size.max(1));
        assert!(v2_size * 5 < du_size, "v2 ({v2_size}) must beat the v1 data-url format ({du_size}) by >5x");
        std::fs::remove_file(&v2_path).ok();
        std::fs::remove_file(&du_path).ok();
    }
}
