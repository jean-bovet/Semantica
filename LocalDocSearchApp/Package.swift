// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LocalDocSearch",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "LocalDocSearch",
            targets: ["LocalDocSearch"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/pvieito/PythonKit.git", branch: "master")
    ],
    targets: [
        .executableTarget(
            name: "LocalDocSearch",
            dependencies: ["PythonKit"],
            path: "LocalDocSearch",
            resources: [
                .process("Resources"),
                .copy("python_src")
            ]
        )
    ]
)