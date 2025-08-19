import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Create window
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        
        window.title = "LocalDocSearch"
        window.center()
        
        // Create a simple message
        let textView = NSTextView(frame: window.contentView!.bounds)
        textView.string = """
        LocalDocSearch - Development Version
        
        This is a simplified version that demonstrates the app structure.
        
        To use the full search functionality:
        1. Install Python dependencies:
           pip install faiss-cpu sentence-transformers PyPDF2 python-docx
        
        2. Run the Python CLI version:
           cd ../local-doc-search
           python cli.py interactive
        
        The full SwiftUI app with Python integration requires:
        - Proper Python embedding (without py2app issues)
        - Or using a Python server with Swift client
        """
        textView.isEditable = false
        textView.autoresizingMask = [.width, .height]
        
        window.contentView = textView
        window.makeKeyAndOrderFront(nil)
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}
