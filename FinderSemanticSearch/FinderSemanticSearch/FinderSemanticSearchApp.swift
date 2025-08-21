//
//  FinderSemanticSearchApp.swift
//  FinderSemanticSearch
//
//  Created by Jean Bovet on 8/19/25.
//

import SwiftUI

@main
struct FinderSemanticSearchApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.titleBar)
        .windowToolbarStyle(.unified)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Index Folder...") {
                    NotificationCenter.default.post(name: .indexFolder, object: nil)
                }
                .keyboardShortcut("i", modifiers: [.command])
            }
        }
    }
}

// AppDelegate to handle app termination and cleanup
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillTerminate(_ notification: Notification) {
        // Force terminate any running Python processes
        PythonCLIBridge.forceStop()
    }
}

extension Notification.Name {
    static let indexFolder = Notification.Name("indexFolder")
}
