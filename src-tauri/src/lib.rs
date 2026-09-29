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
        .invoke_handler(tauri::generate_handler![fetch_link_metadata])
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
