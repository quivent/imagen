//! Native host for the existing local Imagen studio.
//!
//! This baseline deliberately exposes no filesystem, shell or GPU commands to
//! web content. A native renderer will be integrated separately from the UI.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("could not start Imagen");
}
